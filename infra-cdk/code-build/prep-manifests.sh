#!/usr/bin/bash

mkdir -p ./flux-cd/base && cd ./flux-cd/base

echo "Creating a manifest for gateway"
kubectl create namespace multi-tenant-gateway-ns --dry-run=client -o yaml > multi-tenant-gateway-ns.yaml

# It is possible to restrict the set of virtual services that can bind to a gateway server using the 
# namespace/hostname syntax in the hosts field as we did in the following. 
# https://istio.io/v1.3/docs/reference/config/networking/v1alpha3/gateway/
# This gateway will be shared by all virtual services so they share the same TLS certificates. 
# VirtualServices will be bound to this gateway to control the routing of TCP traffic 
# arriving and terminated at gateway port 443, to the tenant applications.

cat << EOF > multi-tenant-gateway.yaml
---
apiVersion: networking.istio.io/v1alpha3
kind: Gateway
metadata:
  name: multi-tenant-gateway
  namespace: multi-tenant-gateway-ns
spec:
  selector:
    istio: ingressgateway  
  servers:
  - port:
      number: 80
      name: http
      protocol: HTTP
    hosts:
    - 'tenanta-ns/*'
    - 'tenantb-ns/*'
    tls:
      httpsRedirect: true # sends 301 redirect for http requests
  - port:
      number: 443
      name: https
      protocol: HTTPS
    hosts:
    - 'tenanta-ns/*'
    - 'tenantb-ns/*'
    tls:
      mode: SIMPLE # enables HTTPS on this port
      credentialName: gateway-ca-tls # fetches certs from Kubernetes secret
      minProtocolVersion: TLSV1_2
      maxProtocolVersion: TLSV1_3
EOF

TENANTS="tenanta tenantb"
for TENANT in $TENANTS
do
  SA_NAME="${TENANT}-sa"
  NAMESPACE="${TENANT}-ns"
  DOMAIN="${TENANT}"

  POOLID=$(
    aws cognito-idp describe-user-pool-domain \
    --domain ${DOMAIN} \
    --query 'DomainDescription.UserPoolId' \
    --output text | xargs
    )

  ISSUER_URI=https://cognito-idp.${AWS_REGION}.amazonaws.com/${POOLID}
  SESSIONS_TABLE=Sessions_${TENANT}_${RANDOM_STRING}
  CHATHISTORY_TABLE=ChatHistory_${TENANT}_${RANDOM_STRING}
  
  echo "Deploying ${TENANT} services ..."
  echo "-> Deploying chatbot service.."

  echo "Applying STRICT mTLS Policy on all application namespaces"
cat << EOF > strictmtls-${TENANT}.yaml
---
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: strict-mtls
  namespace: ${NAMESPACE}
spec:
  mtls:
    mode: STRICT
EOF

  cat << EOF > chatbot-${TENANT}.yaml 
---
apiVersion: v1
kind: ServiceAccount
metadata:
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::${ACCOUNT_ID}:role/${TENANT}-app-access-role
  name: ${SA_NAME}
  namespace: ${NAMESPACE}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: chatbot
  labels:
    app: chatbot
  namespace: ${NAMESPACE}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: chatbot
  template:
    metadata:
      labels:
        workload-tier: frontend
        app: chatbot
    spec:
      serviceAccountName: ${SA_NAME}
      containers:
        - image: ghcr.io/yas2020/eks-istio-multitenant/app-ui:latest
          imagePullPolicy: Always
          name: chatbot
          ports:
            - containerPort: 8501
          env:
          - name: SESSIONS_TABLE
            value: ${SESSIONS_TABLE}
        - image: ghcr.io/yas2020/eks-istio-multitenant/rag-api:latest
          imagePullPolicy: Always
          name: ragapi
          ports:
            - containerPort: 8000
          env:
          - name: CONTEXTUAL_DATA_BUCKET
            value: contextual-data-${TENANT}-${RANDOM_STRING}
          - name: CHATHISTORY_TABLE
            value: ${CHATHISTORY_TABLE}
          - name: TEXT2TEXT_MODEL_ID
            value: ${TEXT2TEXT_MODEL_ID}
          - name: EMBEDDING_MODEL_ID
            value: ${EMBEDDING_MODEL_ID}
          - name: BEDROCK_SERVICE
            value: ${BEDROCK_SERVICE}
          - name: AWS_DEFAULT_REGION
            value: ${AWS_REGION}
---
apiVersion: flagger.app/v1beta1
kind: Canary
metadata:
  name: chatbot
  namespace: ${NAMESPACE}
spec:
  provider: istio
  targetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: chatbot
  progressDeadlineSeconds: 60
  service:
    port: 80
    targetPort: 8501 
    portDiscovery: true
    hosts:
      - ${TENANT}.example.com
    gateways:
      - multi-tenant-gateway-ns/multi-tenant-gateway
  analysis:
    interval: 2m
    iterations: 3
    threshold: 2
    # maxWeight: 30
    # stepWeight: 10
    metrics:
    - name: request-success-rate
      # minimum req success rate (non 5xx responses)
      # percentage (0-100)
      thresholdRange:
        min: 99
      interval: 2m
    - name: request-duration
      # maximum req duration P99
      # milliseconds
      thresholdRange:
        max: 500
      interval: 2m
    webhooks:
      - name: acceptance-test
        type: pre-rollout
        url: http://loadtester.flagger-system/
        timeout: 60s
        metadata:
          type: bash
          cmd: "curl -s http://chatbot-canary.${NAMESPACE}"
      - name: load-test
        type: rollout
        url: http://loadtester.flagger-system/
        timeout: 5s
        metadata:
          cmd: "hey -z 1m -q 10 -c 2 http://chatbot-canary.${NAMESPACE}"
EOF

# We dont create virtual services as they will be created and handled by Flagger. 

# Create a jwt request authentication policy to require requires end-user JWT and requires end-user JWT on
# frontend workload (chatbot app) in namespace where it selects.
# https://istio.io/latest/docs/tasks/security/authentication/claim-to-header/
# https://istio.io/latest/docs/tasks/security/authentication/authn-policy/

  echo "Creating AuthN Policy for ${TENANT}"
  cat << EOF > frontend-jwt-auth-${TENANT}.yaml
apiVersion: security.istio.io/v1beta1
kind: RequestAuthentication
metadata:
  name: frontend-jwt-auth
  namespace: ${NAMESPACE}
spec:
  selector:
    matchLabels:
      workload-tier: frontend
  jwtRules:
  - issuer: "${ISSUER_URI}"
    forwardOriginalToken: true
    outputClaimToHeaders:
    - header: "x-auth-request-tenantid"
      claim: "custom:tenantid"
EOF

# Add a authorization policy to only allow requests with valid tokens for frontend workloads 
# in the tenants namespaces. The policy requires all requests to the frontend workload to have a 
# valid JWT with requestPrincipal, which is the istio ingress gateway. 
# The policy also require the JWT to have a claim named "custom:tenantid", containing the value "tenanta" (or "tenantb")

  echo "Creating AuthZ Policy for ${TENANT}"
  cat << EOF > frontend-authz-pol-${TENANT}.yaml
apiVersion: security.istio.io/v1beta1
kind: AuthorizationPolicy
metadata:
  name: frontend-authz-pol
  namespace: ${NAMESPACE}
spec:
  selector:
    matchLabels:
      workload-tier: frontend
  action: ALLOW
  rules:
  - from:
    - source:
       namespaces: ["istio-ingress"]
       principals: ["cluster.local/ns/istio-ingress/sa/istio-ingressgateway"]
    when:
    - key: request.auth.claims[custom:tenantid]
      values: ["${TENANT}"]
EOF
    
done


#  Create the base kustomization.yaml file
kustomize create --autodetect
cat kustomization.yaml

cd ..
mkdir -p ./overlays/dev && cd ./overlays/dev

cat << EOF > tenanta-ns.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: tenanta-ns
  labels:
    istio-injection: enabled
EOF

cat << EOF > tenantb-ns.yaml
apiVersion: v1
kind: Namespace
metadata:
  name: tenantb-ns
  labels:
    istio-injection: enabled
EOF

cat << EOF > kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
- tenanta-ns.yaml
- tenantb-ns.yaml
- ../../base
images:
- name: ghcr.io/yas2020/eks-istio-multitenant/app-ui
  newName: ghcr.io/yas2020/eks-istio-multitenant/app-ui # {"\$imagepolicy": "flux-system:app-ui:name"}
  newTag: 1.0.0 # {"\$imagepolicy": "flux-system:app-ui:tag"}
- name: ghcr.io/yas2020/eks-istio-multitenant/rag-api
  newName: ghcr.io/yas2020/eks-istio-multitenant/rag-api # {"\$imagepolicy": "flux-system:rag-api:name"}
  newTag: 1.0.0 # {"\$imagepolicy": "flux-system:rag-api:tag"}
EOF

# view the kustomization.yaml file
cat kustomization.yaml

mkdir -p ../../clusters/dev
touch ../../clusters/dev/.gitkeep

