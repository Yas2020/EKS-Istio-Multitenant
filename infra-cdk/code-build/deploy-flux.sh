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

 