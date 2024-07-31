import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { KubectlLayer } from 'aws-cdk-lib/lambda-layer-kubectl';
import { SystemConfig } from "../shared/types";

export function eksCluster (scope: Construct, config: SystemConfig, vpc: ec2.Vpc){

    const cluster = new eks.Cluster(scope, 'MyCluster', {
        version: config.KUBECTL_VERSION,
        authenticationMode: eks.AuthenticationMode.API_AND_CONFIG_MAP,
        bootstrapClusterCreatorAdminPermissions: true,
        defaultCapacity: 0,
        vpc: vpc,
        clusterName: config.EKS_CLUSTER_NAME, 
        kubectlLayer: new KubectlLayer(scope, 'kubectl'),
        // secretsEncryptionKey: clusterKmsKey,
    });

    /* 
    Create an access entry with its cluster admin policy - this uses EKS access management controls for giving access 
    for IAM principals instead of having to use aws-auth configMap which will be removed in future. If you want to 
    disable the ConfigMap method permanently, replace API_AND_CONFIG_MAP with API
    https://docs.aws.amazon.com/eks/latest/userguide/access-entries.html
    https://aws.amazon.com/blogs/containers/a-deep-dive-into-simplified-amazon-eks-access-management-controls/
    */
    cluster.grantAccess('clusterAdminAccess', 
        `arn:aws:iam::${cdk.Stack.of(scope).account}:user/YasCode`, [
            eks.AccessPolicy.fromAccessPolicyName('AmazonEKSClusterAdminPolicy', {
                accessScopeType: eks.AccessScopeType.CLUSTER,
            })
        ],
    );

    /* 
    If not already done, associate IAM OIDC provider of the cluster to allow the cluster to 
    use AWS Identity and Access Management (IAM) for service accounts to use AWS services 
    */
    new iam.OpenIdConnectPrincipal(cluster.openIdConnectProvider)

    return cluster
};


    // /* Need KMS Key for EKS Envelope Encryption, if deleted, KMS will wait default (30 days) time before removal. */
    // // const clusterKmsKey = new Key(this, 'ekskmskey', {
    // //   enableKeyRotation: false,
    // //   alias: cdk.Fn.join('', ['alias/', 'eks/', props.ClusterName]),
    // // });