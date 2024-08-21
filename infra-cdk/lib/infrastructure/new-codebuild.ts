import * as cdk from "aws-cdk-lib";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from 'aws-cdk-lib/aws-iam';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";

import { Construct } from "constructs";
import { SystemConfig } from "./types";
import { Secret } from "aws-cdk-lib/aws-batch";

export interface ConfigAuthProps {
  config: SystemConfig;
//   cluster: eks.Cluster
//   envoySvcAccountRole: iam.Role;
//   appImageURL: string,
//   ragRagImageURL: string
};

export class ConfigAuth extends Construct {
  constructor(scope: Construct, id: string, props: ConfigAuthProps) {
    super(scope, id);
    const {
      config,
    //   cluster,
    //   envoySvcAccountRole,
    //   appImageURL,
    //   ragRagImageURL
    } = props;

    /* 
    Create a github personal access token (named 'GitHub-PAT' in my case) and save 
    it as a secret at secret manager. This secret will be used by codebuild to call github api.
    To create a codebuild credential that can be refered by multiple projects, you can use
    new codebuild.GitHubSourceCredentials(this, 'CodeBuildGitHubCreds', {
      accessToken: cdk.SecretValue.secretsManager('GitHub-PAT'),
    });
    */ 
    
    const buildSpec1 = codebuild.BuildSpec.fromObject({
      version: "0.2",
      phases: {
        install: {
          commands: [
            'echo "Updating system packages..."',
            "sudo apt-get update",
            'echo "Installing awscli"',
            "apt-get install -y awscli",
            'echo "Installing kubectl..."',
            'curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"',
            'chmod +x ./kubectl',
            'echo "kubectl Version:"',
            'kubectl version --client=true',
            'echo "Installing helm"',
            'curl --no-progress-meter \
              -sSL https://raw.githubusercontent.com/helm/helm/master/scripts/get-helm-3 | bash',
            'echo "helm Version:"',
            'helm version',
            'echo "Installing Flux"',
            'curl -s https://fluxcd.io/install.sh | sudo bash',
            'echo "Installing kustomize"',
            'curl --silent --location --remote-name \
"https://github.com/kubernetes-sigs/kustomize/releases/download/kustomize/v3.2.3/kustomize_kustomize.v3.2.3_linux_amd64" && \
chmod a+x kustomize_kustomize.v3.2.3_linux_amd64 && \
sudo mv kustomize_kustomize.v3.2.3_linux_amd64 /usr/local/bin/kustomize'
          ],
        },
        // pre_build: {
        //   commands: [
        //     'echo "Clonning github repo..."',
        //     // "git clone https://github.com/Yas2020/EKS-Istio-Multitenant.git",
        //   ],
        // },
        build: {
          commands: [
            "ls -al",
            "git config --global user.name CodeBuild",
            "git config --global user.email yas.eftekhari@gmail.com",
            "git remote set-url origin https://Yas2020:$GitHub_PAT@github.com/Yas2020/EKS-Istio-Multitenant.git",
            "git config -l",
            "bash infra-cdk/codeBuild/deploy-flux.sh",
            "ls -al",
            'git add flux-cd',
            'git commit -m "flux-cd folder created"',
            'git push'
            // "git add dum.txt",
            // "git commit -m 'codebuild test'",
            // "git push --dry-run",
          ],
        },
      },
    });

    // CodeBuild project
    const project = new codebuild.Project(this, "CodeBuildProject", {
      buildSpec: buildSpec1,
      source: codebuild.Source.gitHub({
        owner: 'Yas2020',
        repo: 'EKS-Istio-Multitenant',
      }),      
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
      },
      environmentVariables: {
        AWS_REGION: {
          value: cdk.Stack.of(this).region
        },
        ISTIO_VERSION: {
          value: config.ISTIO_VERSION
        },
        GitHub_PAT: {
          type: codebuild.BuildEnvironmentVariableType.SECRETS_MANAGER,
          value: 'GitHub-PAT:GitHub-PAT',
        },
      },
    });


    // cluster.awsAuth.addMastersRole(project1.role!);


    project.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "cognito-idp:DescribeUserPoolDomain",
        "cognito-idp:ListUserPoolClients",
        "cognito-idp:DescribeUserPoolClient"
      ],
      resources: ['*'],
    }));

    // cluster.awsAuth.addMastersRole(project2.role!);

    // project2.addToRolePolicy(new iam.PolicyStatement({
    //   actions: [
    //     "eks:DescribeNodegroup",
    //     "eks:DescribeUpdate",
    //     "eks:DescribeCluster"
    //   ],
    //   resources: [cluster.clusterArn],
    // }));

    // project2.addToRolePolicy(new iam.PolicyStatement({
    //   actions: [
    //     "cognito-idp:DescribeUserPoolDomain",
    //     "cognito-idp:ListUserPoolClients",
    //     "cognito-idp:DescribeUserPoolClient"
    //   ],
    //   resources: ['*'],
    // }));

    // project2.addToRolePolicy(new iam.PolicyStatement({
    //   actions: [
    //     "cognito-idp:DescribeUserPoolDomain",
    //     "cognito-idp:ListUserPoolClients",
    //     "cognito-idp:DescribeUserPoolClient"
    //   ],
    //   resources: ['*'],
    // }));
  }
}