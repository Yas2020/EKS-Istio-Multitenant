#!/usr/bin/bash

echo "Updating kube-config..."
aws eks update-kubeconfig --name ${EKS_CLUSTER_NAME}

echo "Creating namespaces"
kubectl create namespace multi-tenant-gateway-ns
kubectl create namespace tenanta-ns
kubectl create namespace tenantb-ns

echo "Enabling sidecar injection in namespaces"
kubectl label namespace tenanta-ns istio-injection=enabled
kubectl label namespace tenantb-ns istio-injection=enabled
kubectl get namespace -L istio-injection

echo "Applying STRICT mTLS Policy on all application namespaces"
cat << EOF > strictmtls.yaml
---
apiVersion: security.istio.io/v1beta1
kind: PeerAuthentication
metadata:
  name: strict-mtls
spec:
  mtls:
    mode: STRICT
EOF

kubectl -n tenanta-ns apply -f strictmtls.yaml
kubectl -n tenantb-ns apply -f strictmtls.yaml

kubectl -n tenanta-ns get PeerAuthentication
kubectl -n tenantb-ns get PeerAuthentication

# It is possible to restrict the set of virtual services that can bind to a gateway server using the 
# namespace/hostname syntax in the hosts field as we did in the following. 
# https://istio.io/v1.3/docs/reference/config/networking/v1alpha3/gateway/
# This gateway will be shared by all virtual services so they share the same TLS certificates. 
# VirtualServices will be bound to this gateway to control the routing of TCP traffic 
# arriving and terminated at gateway port 443, to the tenant applications.

echo "Deploying Istio Gateway resource"
cat << EOF > gateway.yaml
---
apiVersion: networking.istio.io/v1alpha3
kind: Gateway
metadata:
  name: multi-tenant-gateway
spec:
  selector:
    istio: ingressgateway   # use Istio default gateway implementation
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

kubectl -n multi-tenant-gateway-ns apply -f gateway.yaml

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

  cat << EOF > chatbot.yaml 
---
apiVersion: v1
kind: ServiceAccount
metadata:
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::${ACCOUNT_ID}:role/${TENANT}-app-access-role
  name: ${SA_NAME}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: chatbot
  labels:
    app: chatbot
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
        - image: ${CHATBOT_IMAGE_URI}
          imagePullPolicy: Always
          name: chatbot
          ports:
            - containerPort: 8501
          env:
          # - name: ISSUER_URI    not used in app code!
          #   value: ${ISSUER_URI}
          - name: SESSIONS_TABLE
            value: ${SESSIONS_TABLE}
        - image: ${RAGAPI_IMAGE_URI}
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
kind: Service
apiVersion: v1
metadata:
  name: chatbot
  labels:
    app: chatbot
spec:
  selector:
    app: chatbot
  ports:
    - port: 80
      name: http
      targetPort: 8501
EOF

  cat chatbot.yaml
  kubectl -n ${NAMESPACE} apply -f chatbot.yaml

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

  echo "Applying Frontend Authentication Policy for ${TENANT}"
  kubectl -n ${NAMESPACE} apply -f frontend-jwt-auth-${TENANT}.yaml

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

  echo "Applying Frontend Authorization Policy for ${TENANT}"
  kubectl -n ${NAMESPACE} apply -f frontend-authz-pol-${TENANT}.yaml

# Bind virtual services to the gateway - The following routing rule forwards (or routes) traffic arriving 
# at  gateway called “llm-demo-gateway” (at port 443) to internal services (at port 80) in the mesh based on name record in 
# the internal DNS, as <service-name>.<namespace-name>.svc.cluster.local, which becomes the service endpoint 
# referred to by the microservice and the Istio VirtualService construct.
# https://istio.io/v1.3/docs/reference/config/networking/v1alpha3/virtual-service/ 

  cat << EOF > chatbot-vs.yaml
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: chatbot
spec:
  hosts:
  - ${TENANT}.example.com
  gateways:
  # Mention ns as gateway lives in a different ns - otherwise, will not be found by vs
  - multi-tenant-gateway-ns/multi-tenant-gateway
  http:
  - route:
    - destination:
        host: chatbot.${NAMESPACE}.svc.cluster.local
        port:
          number: 80
EOF

  cat chatbot-vs.yaml
  echo "-> Deploying VirtualService to expose chatbot via Ingress Gateway"
  kubectl -n ${NAMESPACE} apply -f chatbot-vs.yaml
    
done