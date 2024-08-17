import { Ec2Action } from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

export interface SystemConfig {
    prefix: string;
    vpc?: {
      vpcId?: string;
      createVpcEndpoints?: boolean;
    };
    certificate?: string;
    domain?: string;
    privateWebsite?: boolean;
    tenants: string[];
    TEXT2TEXT_MODEL_ID: string;
    EMBEDDING_MODEL_ID: string;
    BEDROCK_SERVICE: string;
    EKS_CLUSTER_NAME: string;
    KUBECTL_VERSION: eks.KubernetesVersion
    ISTIO_VERSION: string,
    ALB_VERSION: string,
    sshKeyName: string
  }
  