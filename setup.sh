#!/usr/bin/env bash
if [ ! -d "$HOME/.bash_profile" ]; 
then 
touch ~/.bash_profile;
PATH=$PATH:~/.bash_profile
fi

echo ""
echo "xxxxxxxxxxxxxxxxxxxxxxxxxx"
echo "       S E T  U P         "
echo "xxxxxxxxxxxxxxxxxxxxxxxxxx"
echo ""

sudo apt update
sudo apt upgrade -y

echo "Installing helper tools"

# apt info bash-completion
# sudo apt install bash-completion

echo ""
echo "Installing Node.js"

curl -fsSL https://deb.nodesource.com/setup_22.x -o nodesource_setup.sh
sudo -E bash nodesource_setup.sh
sudo apt-get install -y nodejs

echo ""
echo "-------------------------"
echo "      Node Version:"
node -v
echo "-------------------------"
echo ""


echo ""
echo "Installing AWS CDK Toolkit"
sudo npm install -g aws-cdk@latest
echo ""
echo "-------------------------"
echo "      CDK Version:"
cdk --version
echo "-------------------------"
echo ""


# echo ""
# echo "Installing AWS CLI 2.x"

# curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
# unzip awscliv2.zip
# sudo chmod +x ./aws/install
# sudo ./aws/install
# sudo chmod +x /usr/local/bin/aws

# echo "-------------------------"
# echo "aws version"
# aws --version
# echo "-------------------------"

# rm -rf aws awscliv2.zip

echo ""
echo "Installing kubectl - Kubernetes 1.30"
sudo curl --silent --no-progress-meter --location -o /usr/local/bin/kubectl \
    https://s3.us-west-2.amazonaws.com/amazon-eks/1.30.0/2024-05-12/bin/linux/amd64/kubectl
sudo chmod +x /usr/local/bin/kubectl
mkdir -p $HOME/bin && cp ./kubectl $HOME/bin/kubectl && export PATH=$HOME/bin:$PATH


echo ""
echo "-------------------------"
echo "    kubectl Version:"
kubectl version --client=true
echo "-------------------------"
echo ""

# echo "Installing bash completion for kubectl"
# kubectl completion bash >>  ~/.bash_completion
# . /etc/profile.d/bash_completion.sh
# . ~/.bash_completion


echo "Installing eksctl"
curl --silent --no-progress-meter \
    --location "https://github.com/weaveworks/eksctl/releases/latest/download/eksctl_$(uname -s)_amd64.tar.gz" \
    | tar xz -C /tmp
sudo mv -v /tmp/eksctl /usr/local/bin

echo ""
echo "-------------------------"
echo "     eksctl Version:"
eksctl version
echo "-------------------------"
echo ""

# echo "Installing bash completion for eksctl"
# eksctl completion bash >> ~/.bash_completion
# . /etc/profile.d/bash_completion.sh
# . ~/.bash_completion

echo ""
echo "Installing helm"
curl --no-progress-meter \
    -sSL https://raw.githubusercontent.com/helm/helm/master/scripts/get-helm-3 | bash
echo ""

echo ""
echo "-------------------------"
echo "      helm Version:"
helm version
echo "-------------------------"
echo ""


if [ ! -d "$PWD/istio-1.22.2" ]; 
then 
echo ""
echo "Installing istioctl - V1.22.2"
curl -L https://istio.io/downloadIstio | ISTIO_VERSION=1.22.2 TARGET_ARCH=x86_64 sh -
fi

echo "export PATH=$PWD/istio-1.22.2/bin:$PATH" \
    | tee -a ~/.bash_profile
echo ""



echo ""
echo "-------------------------"
echo "       Configure AWS"
echo "-------------------------"
echo ""

aws configure get region && echo AWS_REGION is "$AWS_REGION" || echo "configure AWS CLI \n" && aws configure

read -p "Press any key to continue"

AWS_REGION=$(aws configure get region)
echo "export AWS_REGION=${AWS_REGION}" \
    | tee -a ~/.bash_profile

export AWS_DEFAULT_REGION=$AWS_REGION

export ACCOUNT_ID=$(aws sts get-caller-identity --output text --query Account) 
echo "export ACCOUNT_ID=${ACCOUNT_ID}" \
    | tee -a ~/.bash_profile


echo ""
echo "-------------------------"
echo "       GitOps Tools"
echo "-------------------------"
echo ""

# Install Flux to communicate with Flux agaents and manage Flux resources in the cluster
curl -s https://fluxcd.io/install.sh | sudo bash


# Install GithubCli
(type -p wget >/dev/null || (sudo apt update && sudo apt-get install wget -y)) \
&& sudo mkdir -p -m 755 /etc/apt/keyrings \
&& wget -qO- https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
&& sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
&& echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
&& sudo apt update \
&& sudo apt install gh -y


# Install kustomize
curl --silent --location --remote-name \
"https://github.com/kubernetes-sigs/kustomize/releases/download/kustomize/v3.2.3/kustomize_kustomize.v3.2.3_linux_amd64" && \
chmod a+x kustomize_kustomize.v3.2.3_linux_amd64 && \
sudo mv kustomize_kustomize.v3.2.3_linux_amd64 /usr/local/bin/kustomize

# Install istioctl
ISTIO_VERSION=1.23.0
curl -L https://istio.io/downloadIstio | ISTIO_VERSION=$ISTIO_VERSION sh -
export PATH=$PWD/$ISTIO_VERSION/bin:$PATH


source ~/.bash_profile
