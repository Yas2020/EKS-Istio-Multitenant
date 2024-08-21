import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { SystemConfig } from "./infrastructure/types";
import { ManagedNodeGroup } from "./infrastructure/node-groups";
import { SvcAccountRoles } from "./infrastructure/svc-account-roles";
import { IdProvider } from "./infrastructure/id-provider-cognito";
import { IstioDeploy } from "./infrastructure/deploy-istio";
import { Shared } from "./infrastructure/shared";
import { ConfigAuth } from "./infrastructure/deploy-ext-auth"
import { eksCluster } from "./infrastructure/cluster"
import { ConfigFlux } from "./infrastructure/new-codebuild"

export interface EksStackProps extends cdk.StackProps {
  readonly config: SystemConfig;
}

export class EksStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: EksStackProps) {
    super(scope, id, props);

    new IdProvider(this, 'openIdCProvider', {tenants: props.config.tenants});
    const shared = new Shared(this, "Shared", { config: props.config });

    // /* Provision a cluster & managed nodegroup */
    const cluster = eksCluster(this, props.config, shared.vpc);
    const nodeGroups = new ManagedNodeGroup(this, "EksManagedNodeGroup", {
      cluster: cluster,
      sshKeyName: props.config.sshKeyName
    });
    
    // /* Provide access to AWS resources */
    const svcAccountRoles = new SvcAccountRoles(this, 'IRSA', {
      cluster: cluster,
      tenants: props.config.tenants
    });

    // /* Deploy istio system - Helm */
    const istioDeploy = new IstioDeploy(this, 'Istio-Deployment', {
      version: props.config.ISTIO_VERSION,
      cluster: cluster,
      clusterName: props.config.EKS_CLUSTER_NAME
    });
    istioDeploy.node.addDependency(nodeGroups);
      
    /* 
    Configure and deploy: 
    1 - authn/authz pipeline and policies (envoy as reverse proxy, OAuth2 proxy per tenant) -CodeBuild
    2 - single istio gateway, virtual services and the application per tenant - CodeBuild 
    */
    const configAuth = new ConfigAuth(this, 'ConfigEnvoyOAuth2Proxies', {
      config: props.config,
      cluster,
      envoySvcAccountRole: svcAccountRoles.envoySvcAccountRole,
      // appImageURL: shared.app_asset.imageUri,
      // ragRagImageURL: shared.api_asset.imageUri
    });
    // configAuth.node.addDependency(istioDeploy);

    new ConfigFlux(this, 'CodeBuild-GitHub', {config:props.config, cluster})

  };
}
