#!/usr/bin/bash

# Allow to interact with Cluster using kubectl
echo "Updating kube-config..."
aws eks update-kubeconfig --name ${EKS_CLUSTER_NAME}

kubectl create namespace flux-system

export GITHUB_USER='Yas2020'
export GITHUB_REPO_URL='https://github.com/Yas2020/EKS-Istio-Multitenant.git'

# Create a GitHub personal access token and export it as an env var - will be used by bootstrap command
export GITHUB_TOKEN=$GitHub_PAT

# Check you have everything needed to run Flux in the next step
flux check --pre

#  Bootstrap our cluster with FluxCD and additional components to enable image automation
flux bootstrap github create \
  --owner=$GITHUB_USER \
  --repository=EKS-Istio-Multitenant \
  --personal \
  --path=./flux-cd/clusters/dev \
  --branch=main \
  --reconcile \
  --network-policy \
  --components-extra=image-reflector-controller,image-automation-controller

# See Flux and all the new CRDs
kubectl get crds | grep flux

# create a Kubernetes secret to store our GitHub credentials for the image-automation-controller to write commits to our repo
flux create secret git chatbot-flux \
  --url=$GITHUB_REPO_URL \
  --username=$GITHUB_USER \
  --password=$GITHUB_TOKEN

# Specifying the git repo as the source
flux create source git chatbot-source \
  --url=$GITHUB_REPO_URL \
  --branch=main \
  --interval=1m \
  --secret-ref=chatbot-flux \
  --export > ./flux-cd/clusters/dev/chatbot-source.yaml

# Specify the Kustomization resource to tell FluxCD where to find the app deployment manifests in our repo.
flux create kustomization chatbot \
  --source=chatbot-source \
  --path="./flux-cd/overlays/dev" \
  --prune=true \
  --wait=true \
  --interval=1m \
  --retry-interval=2m \
  --health-check-timeout=3m \
  --export > ./flux-cd/clusters/dev/chatbot-kustomization.yaml

#  Create the manifest for the ImageRepository resource
flux create image repository app-ui \
  --image=ghcr.io/yas2020/eks-istio-multitenant/app-ui \
  --interval=1m \
  --export > ./flux-cd/clusters/dev/app-ui-image-source.yaml

#  Create the manifest for the ImageRepository resource
flux create image repository rag-api \
  --image=ghcr.io/yas2020/eks-istio-multitenant/rag-api \
  --interval=1m \
  --export > ./flux-cd/clusters/dev/rag-api-image-source.yaml

# Create an ImagePolicy resource to tell FluxCD how to determine the newest image tags. 
# We’ll use the semver filter to only allow image tags that are valid semantic versions and 
# equal to or greater than 1.0.0

flux create image policy app-ui \
  --image-ref=app-ui \
  --select-semver='>=1.0.0' \
  --export > ./flux-cd/clusters/dev/app-ui-image-policy.yaml

flux create image policy rag-api \
  --image-ref=rag-api \
  --select-semver='>=1.0.0' \
  --export > ./flux-cd/clusters/dev/rag-api-image-policy.yaml

# Create an ImageUpdateAutomation resource which enables FluxCD to update images tags 
# in our YAML manifests

flux create image update app-ui \
  --interval=1m \
  --git-repo-ref=chatbot-source \
  --git-repo-path="./flux-cd/overlays/dev" \
  --checkout-branch=main \
  --author-name=fluxcdbot \
  --author-email=fluxcdbot@users.noreply.github.com \
  --commit-template="{{range .Updated.Images}}{{println .}}{{end}}" \
  --export > ./flux-cd/clusters/dev/app-ui-image-update.yaml

flux create image update rag-api \
  --interval=1m \
  --git-repo-ref=chatbot-source \
  --git-repo-path="./flux-cd/overlays/dev" \
  --checkout-branch=main \
  --author-name=fluxcdbot \
  --author-email=fluxcdbot@users.noreply.github.com \
  --commit-template="{{range .Updated.Images}}{{println .}}{{end}}" \
  --export > ./flux-cd/clusters/dev/rag-api-image-update.yaml

# Preparation for Progressive Deliver - Canary

# Install Istio Prometheus
kubectl apply -f https://raw.githubusercontent.com/istio/istio/release-1.22/samples/addons/prometheus.yaml

# Install Flagger -helm
helm repo add flagger https://flagger.app
helm repo update

kubectl create ns flagger-system

helm upgrade -i flagger flagger/flagger \
  --namespace flagger-system \
  --set metricsServer=http://prometheus.istio-system:9090 \
  --set meshProvider=istio

helm upgrade -i loadtester flagger/loadtester \
  --namespace flagger-system