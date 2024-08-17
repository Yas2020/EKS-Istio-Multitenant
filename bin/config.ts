import * as eks from 'aws-cdk-lib/aws-eks';
import { SystemConfig } from "../lib/infrastructure/types";
import { existsSync, readFileSync } from "fs";

export function getConfig(): SystemConfig {
  if (existsSync("./bin/config.json")) {
    return JSON.parse(readFileSync("./bin/config.json").toString("utf8"));
  }

  return {
    prefix: "yas-app",
    // vpc: {
    //   vpcId: xxxxx
    //   createVpcEndpoints: true;
    // };
    certificate: undefined,
    domain: "", 
    privateWebsite: false,
    tenants: ["tenanta", "tenantb"],
    TEXT2TEXT_MODEL_ID: 'meta.llama3-8b-instruct-v1:0',
    EMBEDDING_MODEL_ID: 'amazon.titan-embed-text-v2:0',
    BEDROCK_SERVICE:'bedrock-runtime',
    KUBECTL_VERSION: eks.KubernetesVersion.V1_30,
    ISTIO_VERSION: '1.22.3',
    ALB_VERSION: '1.8.1',
    sshKeyName: "Mutltitenant-App-sshKey",
    EKS_CLUSTER_NAME: 'Multitenant-App'
    }
};

export const config: SystemConfig = getConfig();