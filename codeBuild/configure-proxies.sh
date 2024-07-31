#!/usr/bin/bash

# Allow to interact with Cluster using kubectl
echo "Updating kube-config..."
aws eks update-kubeconfig --name ${EKS_CLUSTER_NAME}

# Validate the CRD installation with the helm ls command - make sure the status is set to deployed
helm ls --all-namespaces
kubectl -n istio-system get pods --output wide
kubectl -n istio-ingress get pods --output wide
kubectl -n cert-manager get pods --output wide

echo ""
echo "##################################################################################"
echo "#                 Configure External Autherization in Mesh                        #"
echo "##################################################################################"
echo ""

# As extra consideration for security, we can use custom CAs to sign tls communications between 
# workloads (or in between different tenants). The following method doesnt use cert manager plugin "istio-csr".
# Instead it uses Kubernetes CSR API. For the others, the default value should stay 'istiod' as before. This feature
# is also useful in multi cluster enviroments. We will NOT make use of this feature for this solution. 

mkdir kustomize && cd kustomize
cat << EOF > cert-provider-patch.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  namespace: istio-system
  name: istiod
spec:
  template:
    spec:
      containers:
        - name: discovery
          env:
          - name: PILOT_CERT_PROVIDER
            value: "k8s.io/clusterissuers.cert-manager.io/istio-system"
EOF

cat << EOF > kustomization.yaml
resources:
- base.yaml
patchesStrategicMerge:
- cert-provider-patch.yaml
EOF

cat << EOF > kustomize.sh
#!/bin/bash
cat > base.yaml
exec kubectl kustomize && rm base.yaml
EOF

sudo chmod +x kustomize.sh
cd ..

kubectl wait --for=condition=Ready certificate/istio-ca -n cert-manager
kubectl wait --for=condition=Ready certificate/tenanta-ca -n cert-manager
kubectl wait --for=condition=Ready certificate/tenantb-ca -n cert-manager
kubectl wait --for=condition=Ready certificate/gateway-tls -n istio-ingress

kubectl get secret -n cert-manager -l controller.cert-manager.io/fao=true

export ISTIOCA=$(kubectl get clusterissuers istio-system -o jsonpath='{.spec.ca.secretName}' | xargs kubectl get secret -n cert-manager -o jsonpath='{.data.ca\.crt}' | base64 -d | sed 's/^/        /')
export TENANTACA=$(kubectl get clusterissuers tenanta -o jsonpath='{.spec.ca.secretName}' | xargs kubectl get secret -n cert-manager -o jsonpath='{.data.ca\.crt}' | base64 -d | sed 's/^/        /')
export TENANTBCA=$(kubectl get clusterissuers tenantb -o jsonpath='{.spec.ca.secretName}' | xargs kubectl get secret -n cert-manager -o jsonpath='{.data.ca\.crt}' | base64 -d | sed 's/^/        /')


cat << EOF > istiod_values.yaml
global:
  pilotCertProvider: istiod
  # List of cert-signers to allow "approve" action in the cluster role
  certSigners:
    - clusterissuers.cert-manager.io/istio-system
    - clusterissuers.cert-manager.io/tenanta
    - clusterissuers.cert-manager.io/tenantb
pilot:
  # Use with caution as these environment variables are experimental and can change anytime
  env:  
    # External CA Integration Type. Permitted value is ISTIOD_RA_KUBERNETES_API 
    EXTERNAL_CA: ISTIOD_RA_KUBERNETES_API   
    CERT_SIGNER_DOMAIN: clusterissuers.cert-manager.io
meshConfig:
  accessLogFile: /dev/stdout
  # Default proxy config for mesh wide defaults, used by gateways and sidecars
  defaultConfig:  
    proxyMetadata:
      ISTIO_META_CERT_SIGNER: istio-system
  extensionProviders:
  - name: rev-proxy
    envoyExtAuthzHttp:
      service: envoy-reverse-proxy.envoy-reverse-proxy-ns.svc.cluster.local
      port: "80" 
      includeRequestHeadersInCheck: ["authorization", "cookie"] # headers sent to the oauth2-proxy in the check request.
      headersToUpstreamOnAllow: ["authorization", "path", "x-auth-request-user", "x-auth-request-email"] # headers sent to backend application when request is allowed
      # headersToDownstreamOnAllow: ["set-cookie"] # headers sent back to the client when request is allowed
      headersToDownstreamOnDeny: ["content-type", "set-cookie"] # headers sent back to the client when request is denied
  caCertificates:
    - pem: |
${ISTIOCA}
      certSigners:
      - clusterissuers.cert-manager.io/istio-system
    - pem: |
${TENANTACA}
      certSigners:
      - clusterissuers.cert-manager.io/tenanta
    - pem: |
${TENANTBCA}
      certSigners:
      - clusterissuers.cert-manager.io/tenantb
EOF

cat istiod_values.yaml

helm repo add istio https://istio-release.storage.googleapis.com/charts
helm repo update

cd kustomize
helm upgrade istio-istiod istio/istiod \
  --namespace istio-system \
  --post-renderer ./kustomize.sh \
  --values ../istiod_values.yaml \
  --version ${ISTIO_VERSION} \
  --timeout 60s \
  --wait

kubectl rollout restart deployment/istiod -n istio-system
# kubectl wait --for=condition=Ready deployment/istiod -n istio-system
kubectl rollout restart deployment/istio-ingressgateway -n istio-ingress
# kubectl wait --for=condition=Ready deployment/istio-ingressgateway -n istio-ingress

helm ls --all-namespaces

# Note: all communications in istio-system now is singed by "istio-system" CA not the regular istiod root CA

echo ""
echo "##################################################################################"
echo "#                             Deploy Authz Pipeline                              #"
echo "##################################################################################"
echo ""

# Envoy is dynamically configured: Envoy listener (downstream) is ingress gateway, and its clusters (upstream) are the associated oauth2-proxy instances per tenant. 

echo "Creating namespaces"
kubectl create namespace envoy-reverse-proxy-ns

echo "Enabling sidecar injection in namespaces"
kubectl label namespace envoy-reverse-proxy-ns istio-injection=enabled

kubectl get namespace -L istio-injection


echo "Applying STRICT mTLS Policy"
cat << EOF | kubectl apply -n envoy-reverse-proxy-ns -f -
---
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: strict-mtls
spec:
  mtls:
    mode: STRICT
EOF

kubectl -n envoy-reverse-proxy-ns get PeerAuthentication


echo "Deploying Envoy Reverse Proxy"
export DOLLAR='$'

cat << EOF > envoy-reverse-proxy.yaml
---
apiVersion: v1
kind: ServiceAccount
metadata:
  annotations:
    eks.amazonaws.com/role-arn: ${ENVOY_S3_ACCESS_ROLE}
  name: envoy-reverse-proxy-sa
---
apiVersion: v1
kind: Service
metadata:
  name: envoy-reverse-proxy
  labels:
    app: envoy-reverse-proxy
spec:
  selector:
    app: envoy-reverse-proxy
  ports:
  - port: 80
    name: http
    targetPort: 8000
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: envoy-reverse-proxy
  labels:
    app: envoy-reverse-proxy
spec:
  replicas: 2
  selector:
    matchLabels:
      app: envoy-reverse-proxy
  minReadySeconds: 60
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 1
  template:
    metadata:
      labels:
        app: envoy-reverse-proxy
      annotations:
        eks.amazonaws.com/skip-containers: "envoy-reverse-proxy"
    spec:
      serviceAccountName: envoy-reverse-proxy-sa
      initContainers:
      - name: envoy-reverse-proxy-bootstrap
        image: public.ecr.aws/aws-cli/aws-cli:2.13.6
        volumeMounts:
        - name: envoy-config-volume
          mountPath: /config/envoy
        command: ["/bin/sh", "-c"]
        args:
          - aws s3 cp s3://${DOLLAR}{ENVOY_CONFIG_S3_BUCKET}/envoy.yaml /config/envoy;
            aws s3 cp s3://${DOLLAR}{ENVOY_CONFIG_S3_BUCKET}/envoy-lds.yaml /config/envoy;
            aws s3 cp s3://${DOLLAR}{ENVOY_CONFIG_S3_BUCKET}/envoy-cds.yaml /config/envoy;
        env:
        - name: ENVOY_CONFIG_S3_BUCKET
          value: ${ENVOY_CONFIG_BUCKET}
      containers:
      - name: envoy-reverse-proxy
        image: envoyproxy/envoy:v1.31.0
        args: ["-c", "/config/envoy/envoy.yaml"]
        imagePullPolicy: Always
        ports:
          - containerPort: 8000
        volumeMounts:
        - name: envoy-config-volume
          mountPath: /config/envoy
      volumes:
      - name: envoy-config-volume
        emptyDir: {}
EOF

cat envoy-reverse-proxy.yaml
kubectl -n envoy-reverse-proxy-ns apply -f envoy-reverse-proxy.yaml

# CUSTOM action (external autherization) on traffic headed to the apps from ingress gateway, apllied to all name sapces
echo "Creating AuthorizationPolicy on Istio Ingress Gateway"
cat << EOF > ext-authz-policy.yaml
---
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: cluster1-auth-policy
  namespace: istio-system
spec:
  selector:
    matchLabels:
      istio: ingressgateway
  action: CUSTOM
  provider:
    name: rev-proxy
  rules:
    - to:
      - operation:
          hosts:
          - tenanta.example.com
          - tenantb.example.com
EOF

kubectl apply -f ext-authz-policy.yaml

# In order to use the CUSTOM action in the authorization policy, you must define the external authorizer 
# that is allowed to be used in the mesh. This is currently defined in the extension provider in the mesh config.
# The following content defines one external provider called "rev-proxy" using the service 
# envoy-reverse-proxy deployed above. The service implements the HTTP check API as defined by the Envoy rev-proxy filter. 
# You can modify the extension provider to control the behavior of the rev proxy filter for things like 
# what headers to send to the external authorizer, what headers to send to the application backend, 
# the status to return on error and more. headersToUpstreamOnAllow are the headers sent to backend application 
# when request is allowed. headersToDownstreamOnAllow are the headers sent back to the client when request is allowed.
# includeHeadersInCheck: headers sent to the oauth2-proxy in the check request
# headersToUpstreamOnAllow: headers sent to backend application when request is allowed
# headersToDownstreamOnDeny: headers sent back to the client when request is denied
# https://istio.io/latest/docs/tasks/security/authorization/authz-custom/

echo ""
echo "Configure and Deploy OAuth2 Proxies"

echo "Creating namespaces and labeling"
kubectl create namespace tenanta-oidc-proxy-ns
kubectl create namespace tenantb-oidc-proxy-ns
kubectl label namespace tenanta-oidc-proxy-ns istio-injection=enabled
kubectl label namespace tenantb-oidc-proxy-ns istio-injection=enabled

# Add oauth2-proxy Helm Repo
helm repo add oauth2-proxy https://oauth2-proxy.github.io/manifests
helm repo update

TENANTS="tenanta tenantb"

for t in $TENANTS
do 
  COOKIE_SECRET=$(openssl rand -base64 32 | head -c 32 | base64)
  CALLBACK_URI="https://${t}.example.com/oauth2/callback"
  DOMAIN="${t}"
  
  POOLID=$(
      aws cognito-idp describe-user-pool-domain \
      --domain ${DOMAIN} \
      --query 'DomainDescription.UserPoolId' \
      --output text | xargs
      )

  ISSUER_URI=https://cognito-idp.${AWS_REGION}.amazonaws.com/${POOLID}

  CLIENTID=$(
      aws cognito-idp list-user-pool-clients \
      --user-pool-id ${POOLID} \
      --query "UserPoolClients[0].ClientId" \
      --output text | xargs
      )

  CLIENTSECRET=$(
      aws cognito-idp describe-user-pool-client \
      --user-pool-id ${POOLID} \
      --client-id ${CLIENTID} \
      --query "UserPoolClient.ClientSecret" \
      --output text | xargs
      )
  
  echo "Creating oauth2-proxy Configuration for ${t}"
  cat << EOF > oauth2-proxy-${t}-values.yaml
---
config:
  clientID: "${CLIENTID}"
  clientSecret: "${CLIENTSECRET}"
  cookieSecret: "${COOKIE_SECRET}="
  configFile: |-
    auth_logging = true
    cookie_httponly = true
    cookie_refresh = "1h"
    cookie_secure = true
    oidc_issuer_url = "${ISSUER_URI}"
    redirect_url = "${CALLBACK_URI}"
    scope="openid"
    reverse_proxy = true
    pass_host_header = true
    pass_access_token = true
    pass_authorization_header = true
    provider = "oidc"
    request_logging = true
    set_authorization_header = true
    set_xauthrequest = true
    session_store_type = "cookie"
    silence_ping_logging = true
    skip_provider_button = true
    skip_auth_strip_headers = false
    ssl_insecure_skip_verify = true
    skip_jwt_bearer_tokens = true
    standard_logging = true
    upstreams = [ "static://200" ]
    email_domains = [ "*" ]
    whitelist_domains = ["${t}.example.com"]
EOF
  
  cat oauth2-proxy-${t}-values.yaml

  echo "Deploying OIDC Proxy for ${t}"
  helm upgrade --install --namespace ${t}-oidc-proxy-ns oauth2-proxy \
    oauth2-proxy/oauth2-proxy -f oauth2-proxy-${t}-values.yaml

done