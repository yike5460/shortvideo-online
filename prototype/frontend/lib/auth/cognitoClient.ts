import { 
  CognitoUserPool, 
  CognitoUser, 
  AuthenticationDetails,
  CognitoUserAttribute,
  ICognitoUserPoolData,
  CognitoUserSession,
  ISignUpResult,
  CognitoUserAttribute as ICognitoUserAttribute
} from 'amazon-cognito-identity-js';

// Configuration would come from environment variables set after deployment
let _userPool: CognitoUserPool | null = null;

function getUserPool(): CognitoUserPool {
  if (!_userPool) {
    const poolData: ICognitoUserPoolData = {
      UserPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || 'placeholder',
      ClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || 'placeholder'
    };
    _userPool = new CognitoUserPool(poolData);
  }
  return _userPool;
}

export interface CognitoSessionData {
  session: {
    accessToken: string;
    idToken: string;
    refreshToken: string;
  };
  user: {
    sub: string;
    email: string;
    email_verified: string;
    [key: string]: any;
  };
}

export const cognitoClient = {
  // Sign up new user
  signUp: (email: string, password: string): Promise<ISignUpResult> => {
    return new Promise((resolve, reject) => {
      const attributeList = [
        new CognitoUserAttribute({ 
          Name: 'email', 
          Value: email 
        })
      ];

      getUserPool().signUp(email, password, attributeList, [], (err: Error | undefined, result: ISignUpResult | undefined) => {
        if (err) {
          reject(err);
          return;
        }
        if (result) {
          resolve(result);
        } else {
          reject(new Error('Sign up result is undefined'));
        }
      });
    });
  },
  // Confirm registration with verification code
  confirmRegistration: (email: string, code: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const userData = {
        Username: email,
        Pool: getUserPool()
      };
      
      const cognitoUser = new CognitoUser(userData);
      
      cognitoUser.confirmRegistration(code, true, (err: Error | undefined, result: string) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(result);
      });
    });
  },
  
  // Resend verification code
  resendVerificationCode: (email: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const userData = {
        Username: email,
        Pool: getUserPool()
      };
      
      const cognitoUser = new CognitoUser(userData);
      
      cognitoUser.resendConfirmationCode((err: Error | undefined, result: string) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(result);
      });
    });
  },
  
  // Sign in
  signIn: (email: string, password: string): Promise<CognitoSessionData> => {
    return new Promise((resolve, reject) => {
      const authenticationData = {
        Username: email,
        Password: password
      };
      
      const authenticationDetails = new AuthenticationDetails(authenticationData);
      
      const userData = {
        Username: email,
        Pool: getUserPool()
      };
      
      const cognitoUser = new CognitoUser(userData);
      
      cognitoUser.authenticateUser(authenticationDetails, {
        onSuccess: (result: CognitoUserSession) => {
          // Get user attributes
          cognitoUser.getUserAttributes((err: Error | undefined, attributes?: ICognitoUserAttribute[]) => {
            if (err) {
              reject(err);
              return;
            }
            
            const userData: any = { email };
            
            if (attributes) {
              attributes.forEach((attr: ICognitoUserAttribute) => {
                userData[attr.getName()] = attr.getValue();
              });
            }

            resolve({
              session: {
                accessToken: result.getAccessToken().getJwtToken(),
                idToken: result.getIdToken().getJwtToken(),
                refreshToken: result.getRefreshToken().getToken()
              },
              user: userData
            });
          });
        },
        onFailure: (err: Error) => {
          reject(err);
        }
      });
    });
  },
  
  // Sign out
  signOut: (): void => {
    const cognitoUser = getUserPool().getCurrentUser();
    if (cognitoUser) {
      cognitoUser.signOut();
    }
  },
  
  // Get current session
  getCurrentSession: (): Promise<CognitoSessionData | null> => {
    return new Promise((resolve, reject) => {
      const cognitoUser = getUserPool().getCurrentUser();
      
      if (!cognitoUser) {
        resolve(null);
        return;
      }
      
      cognitoUser.getSession((err: Error | null, session: CognitoUserSession) => {
        if (err) {
          reject(err);
          return;
        }
        
        cognitoUser.getUserAttributes((err: Error | undefined, attributes?: ICognitoUserAttribute[]) => {
          if (err) {
            reject(err);
            return;
          }
          
          const userData: any = {};
          if (attributes) {
            attributes.forEach((attr: ICognitoUserAttribute) => {
              userData[attr.getName()] = attr.getValue();
            });
          }
          
          resolve({
            user: userData,
            session: {
              accessToken: session.getAccessToken().getJwtToken(),
              idToken: session.getIdToken().getJwtToken(),
              refreshToken: session.getRefreshToken().getToken()
            }
          });
        });
      });
    });
  },
  
  // Forgot password
  forgotPassword: (email: string): Promise<any> => {
    return new Promise((resolve, reject) => {
      const userData = {
        Username: email,
        Pool: getUserPool()
      };
      
      const cognitoUser = new CognitoUser(userData);
      
      cognitoUser.forgotPassword({
        onSuccess: (data: any) => {
          resolve(data);
        },
        onFailure: (err: Error) => {
          reject(err);
        }
      });
    });
  },
  
  // Confirm new password after reset
  confirmPassword: (email: string, verificationCode: string, newPassword: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const userData = {
        Username: email,
        Pool: getUserPool()
      };
      
      const cognitoUser = new CognitoUser(userData);
      
      cognitoUser.confirmPassword(verificationCode, newPassword, {
        onSuccess: () => {
          resolve('Password confirmed!');
        },
        onFailure: (err: Error) => {
          reject(err);
        }
      });
    });
  }
};
