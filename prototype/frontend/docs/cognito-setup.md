# Amazon Cognito Authentication Setup

This document provides instructions on how to set up and use the Amazon Cognito authentication system for the Video Search application.

## Overview

The application uses Amazon Cognito for user authentication with the following features:
- User registration and sign-in
- Email verification
- Password reset
- Session management
- Secure access to AWS resources

## Deployment Steps

1. Deploy the CDK stack which includes the Cognito resources:
   ```bash
   cd /path/to/project
   cdk deploy VideoSearchStack
   ```

2. Note the Cognito-related outputs from the deployment:
   - UserPoolId
   - UserPoolClientId 
   - IdentityPoolId

3. Create an `.env.local` file in the frontend directory using the `.env.local.example` as a template:
   ```bash
   cd prototype/frontend
   cp .env.local.example .env.local
   ```

4. Update the `.env.local` file with the Cognito values from the CDK deployment:
   ```
   NEXT_PUBLIC_COGNITO_REGION=us-east-1  # Replace with your region
   NEXT_PUBLIC_COGNITO_USER_POOL_ID=us-east-1_xxxxxxxxx  # From CDK output
   NEXT_PUBLIC_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx  # From CDK output
   NEXT_PUBLIC_COGNITO_IDENTITY_POOL_ID=us-east-1:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx  # From CDK output
   ```

5. Start the frontend application:
   ```bash
   npm run dev
   ```

## Authentication Flow

### User Registration
1. User visits the registration page
2. Enters email, password, and confirms password
3. Submits the form, which calls Cognito to create a new user
4. User receives a verification code via email
5. User enters the verification code to confirm their account
6. Upon successful verification, the user is redirected to the login page

### User Login
1. User visits the login page
2. Enters email and password
3. If credentials are valid, the user is authenticated and a session is created
4. The session information is stored in the browser's session storage
5. The user is redirected to the application's main page

### Password Reset
1. User clicks "Forgot password" on the login page
2. User enters their email address
3. User receives a verification code via email
4. User enters the verification code and new password
5. Upon successful password reset, the user is redirected to the login page

## Security Considerations

- The authentication tokens are stored in the browser's session storage
- Tokens have limited lifetime and need to be refreshed
- Sensitive operations require re-authentication
- API calls are secured with IAM policies
- S3 access is controlled via Cognito Identity Pool

## Common Issues and Troubleshooting

### User can't receive verification emails
- Check if the email is valid
- Check if the email is in the spam folder
- Make sure the Cognito User Pool is properly configured to send emails

### Authentication tokens expire too quickly
- Adjust the token expiration time in the Cognito User Pool settings
- Implement token refresh functionality

### API calls return unauthorized errors
- Check if the user is properly authenticated
- Verify that the IAM policies are correctly set up
- Ensure that the API Gateway is configured to accept Cognito tokens

## Additional Resources

- [Amazon Cognito Documentation](https://docs.aws.amazon.com/cognito/latest/developerguide/what-is-amazon-cognito.html)
- [AWS Amplify Authentication](https://docs.amplify.aws/lib/auth/getting-started/q/platform/js/)
- [Amazon Cognito Identity JS](https://github.com/amazon-archives/amazon-cognito-identity-js)
