#! usr/bin/bash

TENANTS="tenanta tenantb"
USERS="test"

for TENANT in $TENANTS
do
  DOMAIN="${TENANT}"
  READ_ATTR="custom:tenantid"
  USER_ATTR="custom:tenantid"

  POOLID=$(
    aws cognito-idp describe-user-pool-domain \
    --domain ${DOMAIN} \
    --query 'DomainDescription.UserPoolId' \
    --output text | xargs
    )
  
  for u in ${USERS}
  do
    USER=${u}@${TENANT}.com
    echo "Creating ${USER} in ${POOLID}"
    read -s -p "Enter a Password for user ${USER} in ${TENANT}: " PASSWORD
    printf "\n"
    
    aws cognito-idp admin-create-user \
    --user-pool-id ${POOLID} \
    --username ${USER}  2>&1 > /dev/null
    aws cognito-idp admin-set-user-password \
    --user-pool-id ${POOLID} \
    --username ${USER} \
    --password ${PASSWORD} \
    --permanent
    
    echo "Setting User Custom Attributes for ${USER}"
    aws cognito-idp admin-update-user-attributes \
        --user-pool-id ${POOLID} \
        --username ${USER} \
        --user-attributes Name="${USER_ATTR}",Value="${TENANT}"

    aws cognito-idp admin-update-user-attributes \
        --user-pool-id ${POOLID} \
        --username ${USER}	 \
        --user-attributes Name="email",Value="${USER}"
    
    aws cognito-idp admin-update-user-attributes \
        --user-pool-id ${POOLID} \
        --username ${USER}	 \
        --user-attributes Name="email_verified",Value="true"
  done
done