import { 
  OpenSearchClient, 
  CreateVpcEndpointCommand, 
  DeleteVpcEndpointCommand,
  CreateVpcEndpointCommandInput,
  DeleteVpcEndpointCommandInput,
  VPCOptions
} from "@aws-sdk/client-opensearch";
import type { Context } from 'aws-lambda';

interface CustomResourceEvent {
  RequestType: 'Create' | 'Update' | 'Delete';
  ResourceProperties: {
    DomainName: string;
    VpcId: string;
    SubnetIds: string[];
    SecurityGroupIds: string[];
  };
  RequestId: string;
  PhysicalResourceId: string;
  LogicalResourceId: string;
  StackId: string;
  ResponseURL: string;
}

interface CloudFormationResponse {
  PhysicalResourceId: string;
  Data?: {
    EndpointId?: string;
    DomainName?: string;
  };
  Status?: 'SUCCESS' | 'FAILED';
  Reason?: string;
}

async function sendCloudFormationResponse(event: CustomResourceEvent, response: CloudFormationResponse): Promise<void> {
  const responseBody = JSON.stringify({
    Status: response.Status || 'SUCCESS',
    Reason: response.Reason || 'See CloudWatch logs for details',
    PhysicalResourceId: response.PhysicalResourceId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: response.Data
  });

  console.log('Sending response to CloudFormation:', responseBody);

  try {
    const fetch = await import('node-fetch');
    await fetch.default(event.ResponseURL, {
      method: 'PUT',
      body: responseBody,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  } catch (error) {
    console.error('Error sending response to CloudFormation:', error);
    throw error;
  }
}

exports.handler = async function(event: CustomResourceEvent, context: Context): Promise<void> {
  // Get region from environment variable or default to us-east-1
  const region = process.env.AWS_REGION || 'us-east-1';
  console.log('Using region:', region);
  console.log('Event:', JSON.stringify(event, null, 2));
  
  const client = new OpenSearchClient({ 
    region,
    maxAttempts: 3 // Add retry mechanism
  });
  
  const props = event.ResourceProperties;
  let response: CloudFormationResponse;
  
  try {
    switch (event.RequestType) {
      case 'Create':
      case 'Update': {
        const vpcOptions: VPCOptions = {
          SubnetIds: props.SubnetIds,
          SecurityGroupIds: props.SecurityGroupIds
        };

        const params: CreateVpcEndpointCommandInput = {
          ClientToken: event.RequestId,
          DomainName: props.DomainName,
          VpcOptions: vpcOptions
        };

        console.log('Creating/Updating VPC endpoint with params:', JSON.stringify(params, null, 2));

        const command = new CreateVpcEndpointCommand(params);
        const result = await client.send(command);
        console.log('Create/Update response:', JSON.stringify(result, null, 2));
        
        if (!result.VpcEndpoint?.VpcEndpointId) {
          throw new Error('VPC Endpoint ID not found in response');
        }

        response = {
          PhysicalResourceId: result.VpcEndpoint.VpcEndpointId,
          Status: 'SUCCESS',
          Data: {
            EndpointId: result.VpcEndpoint.VpcEndpointId,
            DomainName: props.DomainName
          }
        };
        break;
      }

      case 'Delete': {
        // For delete operations, always return the existing PhysicalResourceId
        const physicalId = event.PhysicalResourceId || 'endpoint-id-unknown';
        
        if (physicalId === 'endpoint-id-unknown') {
          console.log('No endpoint to delete');
          response = {
            PhysicalResourceId: physicalId,
            Status: 'SUCCESS'
          };
          break;
        }
        
        console.log('Deleting VPC endpoint:', physicalId);
        const params: DeleteVpcEndpointCommandInput = {
          VpcEndpointId: physicalId
        };

        const command = new DeleteVpcEndpointCommand(params);
        await client.send(command);
        console.log('Successfully deleted VPC endpoint');
        
        response = {
          PhysicalResourceId: physicalId,
          Status: 'SUCCESS'
        };
        break;
      }

      default: {
        throw new Error(`Unsupported request type: ${event.RequestType}`);
      }
    }

    await sendCloudFormationResponse(event, response);
  } catch (error) {
    console.error('Error:', error);
    // Add more detailed error logging
    if (error instanceof Error) {
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
      
      response = {
        PhysicalResourceId: event.PhysicalResourceId || context.awsRequestId,
        Status: 'FAILED',
        Reason: error.message,
        Data: {
          Error: error.message
        }
      };
    } else {
      response = {
        PhysicalResourceId: event.PhysicalResourceId || context.awsRequestId,
        Status: 'FAILED',
        Reason: 'Unknown error occurred',
        Data: {
          Error: 'Unknown error occurred'
        }
      };
    }

    // Always try to send response to CloudFormation, even if the operation failed
    await sendCloudFormationResponse(event, response);
    throw error; // Rethrow to mark the Lambda execution as failed
  }
} 