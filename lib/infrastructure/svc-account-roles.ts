import { Construct } from "constructs";
import * as cdk from 'aws-cdk-lib';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as iam from 'aws-cdk-lib/aws-iam';


export interface svcAccountRolesProps {
    cluster: eks.Cluster,
    tenants: string[]
}

export class SvcAccountRoles extends Construct {
    readonly envoySvcAccountRole: iam.Role;
    readonly tenantSvcAccountRoles: iam.Role[];

    constructor(scope: Construct, id: string, props: svcAccountRolesProps) {
        super(scope, id);

        const {cluster, tenants} = props;
        this.tenantSvcAccountRoles = [];

        

        const conditions = new cdk.CfnJson(scope, 'ConditionJson1', {
            value: {
            [`${cluster.clusterOpenIdConnectIssuer}:aud`]: 'sts.amazonaws.com',
            [`${cluster.clusterOpenIdConnectIssuer}:sub`]: "system:serviceaccount:envoy-reverse-proxy-ns:envoy-reverse-proxy-sa"
            }
        });

        /* Creates a conditional trust policy whose principal is cluster's default OpenID provider */
        const envoySvcAccountRole = new iam.Role(scope, "IRSA-envoy", {
            assumedBy: new iam.WebIdentityPrincipal(
                `arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:oidc-provider/${cluster.clusterOpenIdConnectIssuer}`
            ).withConditions({
            StringLike: conditions,
            }),
        });

        /* Attach s3 bucket policy to the trust policy above */
        envoySvcAccountRole.addToPolicy(
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                    "s3:GetObject",
                    "s3:GetObjectVersion"
                ],
                resources: [
                    `arn:aws:s3:::envoy-config-${cdk.Stack.of(scope).node.addr.slice(0,5)}/*`
                ]
            })
        );

        this.envoySvcAccountRole = envoySvcAccountRole;

        for (const tenant of tenants) {
            /* Create service account roles for applications in each tenant */
            let tenantSvcAccountRole = new iam.Role(scope, `IRSA-${tenant}`, {
                roleName: `${tenant}-app-access-role`,
                assumedBy: new iam.WebIdentityPrincipal(
                    `arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:oidc-provider/${cluster.clusterOpenIdConnectIssuer}`
                ).withConditions({
                    StringLike: new cdk.CfnJson(scope, `ConditionJson-${tenant}`, {
                        value: {
                            [`${cluster.clusterOpenIdConnectIssuer}:aud`]: 'sts.amazonaws.com',
                            [`${cluster.clusterOpenIdConnectIssuer}:sub`]: `system:serviceaccount:${tenant}-ns:${tenant}-sa`
                        }
                    })
                })
            });

            tenantSvcAccountRole.addToPolicy(
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    actions: [
                        "s3:GetObject",
                        "s3:GetObjectVersion"
                    ],
                    resources: [
                        `arn:aws:s3:::contextual-data-${tenant}-${cdk.Stack.of(scope).node.addr.slice(0,5)}/*`
                    ]
                })
            );

            tenantSvcAccountRole.addToPolicy(
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    actions: [
                        "dynamodb:GetItem",
                        "dynamodb:BatchGetItem",
                        "dynamodb:Query",
                        "dynamodb:DescribeTable",
                        "dynamodb:DeleteItem",
                        "dynamodb:Scan",
                        "dynamodb:PutItem",
                        "dynamodb:UpdateItem",
                        "dynamodb:BatchWriteItem",
                        "dynamodb:ConditionCheckItem",
                    ],
                    resources: [
                        `arn:aws:dynamodb:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:table/Sessions_${tenant}_${cdk.Stack.of(scope).node.addr.slice(0,5)}`,
                        `arn:aws:dynamodb:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:table/Sessions_${tenant}_${cdk.Stack.of(scope).node.addr.slice(0,5)}/index/*`,
                        `arn:aws:dynamodb:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:table/ChatHistory_${tenant}_${cdk.Stack.of(scope).node.addr.slice(0,5)}`,
                        `arn:aws:dynamodb:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:table/ChatHistory_${tenant}_${cdk.Stack.of(scope).node.addr.slice(0,5)}/index/*`
                    ]
                })
            );

            tenantSvcAccountRole.addToPolicy(
                new iam.PolicyStatement({
                    effect: iam.Effect.ALLOW,
                    actions: [
                        "bedrock:InvokeModel"
                    ],
                    resources: ["*"]
                })
            );

            this.tenantSvcAccountRoles.push(tenantSvcAccountRole)
        }; 
        
}}