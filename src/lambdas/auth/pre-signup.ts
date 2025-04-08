/**
 * Cognito Pre-Signup Lambda Trigger
 * 
 * This function is triggered before a user is signed up to the Cognito User Pool.
 * It checks if the user's email domain matches the allowed domain (amazon.com).
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
  console.log('Pre-signup trigger event', JSON.stringify(event, null, 2));
  
  const { email } = event.request.userAttributes;
  const allowedDomain = process.env.ALLOWED_DOMAIN || 'amazon.com';
  
  if (!email.endsWith(`@${allowedDomain}`)) {
    console.error(`Registration attempt with non-${allowedDomain} email: ${email}`);
    throw new Error(`Only ${allowedDomain} email addresses are allowed to register`);
  }
  
  console.log(`Email ${email} passed domain validation`);
  
  // Return the event object to allow the signup to proceed
  return event;
};
