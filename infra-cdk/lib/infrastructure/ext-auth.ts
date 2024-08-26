import * as cdk from "aws-cdk-lib";
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import * as iam from 'aws-cdk-lib/aws-iam';
import * as eks from 'aws-cdk-lib/aws-eks';

import { Construct } from "constructs";
import { SystemConfig } from "./types";

export interface ConfigAuthProps {
  config: SystemConfig;
  cluster: eks.Cluster
  envoySvcAccountRole: iam.Role;
};

export class ConfigAuth extends Construct {
  constructor(scope: Construct, id: string, props: ConfigAuthProps) {
    super(scope, id);
    const {
      config,
      cluster,
      envoySvcAccountRole,
    } = props;

    const buildSpec1 = codebuild.BuildSpec.fromObject({
      version: "0.2",
      phases: {
        install: {
          commands: [
            'echo "Updating system packages..."',
            "sudo apt-get update",
            'echo "Installing curl, wget, jq, tar, awscli"',
            "apt-get install -y curl wget jq tar awscli",
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
          ],
        },
        build: {
          commands: [
            'echo "Configuring istio proxies..."',
            "bash infra-cdk/code-build/configure-proxies.sh",
            'echo "istio proxies configured!"',
          ],
        },
      },
    });
    
    // CodeBuild project
    const project1 = new codebuild.Project(this, "CodeBuildProject", {
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
        GitHub_PAT: {
          type: codebuild.BuildEnvironmentVariableType.SECRETS_MANAGER,
          value: 'GitHub-PAT:GitHub-PAT',
        },
        ISTIO_VERSION: {
          value: config.ISTIO_VERSION
        },
        ENVOY_CONFIG_BUCKET: {
          value: `envoy-config-${cdk.Stack.of(this).node.addr.slice(0,5)}`
        },
        ENVOY_S3_ACCESS_ROLE: {
          value: envoySvcAccountRole.roleArn
        },
        EKS_CLUSTER_NAME: {
          value: cluster.clusterName
        },
      },
    });

    cluster.awsAuth.addMastersRole(project1.role!);
    project1.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "eks:DescribeNodegroup",
        "eks:DescribeUpdate",
        "eks:DescribeCluster"
      ],
      resources: [cluster.clusterArn],
    }));

    project1.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        "cognito-idp:DescribeUserPoolDomain",
        "cognito-idp:ListUserPoolClients",
        "cognito-idp:DescribeUserPoolClient"
      ],
      resources: ['*'],
    }));

  }
}