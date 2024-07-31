import * as cognito from "aws-cdk-lib/aws-cognito";
import { Construct } from "constructs";

export class IdProvider extends Construct {
  constructor(scope: Construct, id: string, props: {tenants: string[]}) {
    super(scope, id);

    for (const tenant of props.tenants) {
      const userPool = new cognito.CfnUserPool(this, tenant + "UserPool", {
        userPoolName: tenant,
        adminCreateUserConfig: {
            allowAdminCreateUserOnly: true
        },
        mfaConfiguration: 'OFF',
        policies: {
            passwordPolicy: {
                minimumLength: 8,
                requireLowercase: true,
                requireNumbers: true,
                requireSymbols: true,
                requireUppercase: true,
                temporaryPasswordValidityDays: 30
            }
        },
        schema: [
          {
            attributeDataType: 'String',
            developerOnlyAttribute: false,
            mutable: true,
            name: 'email',
            required: true,
            stringAttributeConstraints: {
              maxLength: '64',
              minLength: '1',
            },
          },
          {
            attributeDataType: 'String',
            developerOnlyAttribute: false,
            mutable: true,
            name: 'tenantid',
            required: false,
            stringAttributeConstraints: {
              maxLength: '20',
              minLength: '1',
            },
          },
        ],
        usernameConfiguration: {
          caseSensitive: false,
        },
      });
      
      new cognito.CfnUserPoolClient(this, tenant + "UserPoolClient", {
        userPoolId: userPool.attrUserPoolId,
        clientName: tenant + "-app-client",
        generateSecret: true,
        refreshTokenValidity: 1,
        accessTokenValidity: 1,
        idTokenValidity: 1,
        tokenValidityUnits: {accessToken:"hours", idToken:"hours", refreshToken:"hours"},
        readAttributes: ["custom:tenantid", "email", "email_verified"],
        explicitAuthFlows: ["ALLOW_REFRESH_TOKEN_AUTH"],
        preventUserExistenceErrors: "ENABLED",
        supportedIdentityProviders: ["COGNITO"],
        allowedOAuthFlows: ["code"],
        allowedOAuthScopes: ["openid"],
        allowedOAuthFlowsUserPoolClient: true,
        callbackUrLs: [`https://${tenant}.example.com/oauth2/callback`],
        logoutUrLs: [`https://${tenant}.example.com`]
      });

      new cognito.CfnUserPoolDomain(this, tenant + '-CognitoDomain', {
        domain: tenant,
        userPoolId: userPool.attrUserPoolId,
      });
    }
  };
};

// users will be created using aws cli :
// run chmod +x create_cognito_users.sh && bash create_cognito_users.sh