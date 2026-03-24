/**
 * Cognito Pre-Signup Lambda Trigger
 *
 * This function is triggered before a user is signed up to the Cognito User Pool.
 * It auto-confirms the user and verifies their email.
 */

interface CognitoPreSignupEvent {
  version: string;
  region: string;
  userPoolId: string;
  userName: string;
  callerContext: {
    awsSdkVersion: string;
    clientId: string;
  };
  triggerSource: string;
  request: {
    userAttributes: {
      email: string;
      [key: string]: string;
    };
    validationData?: { [key: string]: string } | null;
  };
  response: {
    autoConfirmUser: boolean;
    autoVerifyEmail: boolean;
    autoVerifyPhone: boolean;
  };
}

export const handler = async (event: CognitoPreSignupEvent): Promise<CognitoPreSignupEvent> => {
  const { email } = event.request.userAttributes;
  console.log(`Pre-signup trigger for email: ${email}`);

  // Auto-confirm user and verify email
  event.response.autoConfirmUser = true;
  event.response.autoVerifyEmail = true;

  return event;
};
