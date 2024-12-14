"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_opensearch_1 = require("@aws-sdk/client-opensearch");
const node_fetch_1 = __importDefault(require("node-fetch"));
async function sendCloudFormationResponse(event, response) {
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
        const fetchResponse = await (0, node_fetch_1.default)(event.ResponseURL, {
            method: 'PUT',
            body: responseBody,
            headers: {
                'Content-Type': 'application/json',
            },
        });
        if (!fetchResponse.ok) {
            throw new Error(`HTTP error! status: ${fetchResponse.status}`);
        }
    }
    catch (error) {
        console.error('Error sending response to CloudFormation:', error);
        throw error;
    }
}
exports.handler = async function (event, context) {
    var _a;
    // Get region from environment variable or default to us-east-1
    const region = process.env.AWS_REGION || 'us-east-1';
    console.log('Using region:', region);
    console.log('Event:', JSON.stringify(event, null, 2));
    const client = new client_opensearch_1.OpenSearchClient({
        region,
        maxAttempts: 3 // Add retry mechanism
    });
    const props = event.ResourceProperties;
    let response;
    try {
        switch (event.RequestType) {
            case 'Create':
            case 'Update': {
                const vpcOptions = {
                    SubnetIds: props.SubnetIds,
                    SecurityGroupIds: props.SecurityGroupIds
                };
                const params = {
                    ClientToken: event.RequestId,
                    DomainArn: props.DomainArn,
                    VpcOptions: vpcOptions
                };
                console.log('Creating/Updating VPC endpoint with params:', JSON.stringify(params, null, 2));
                const command = new client_opensearch_1.CreateVpcEndpointCommand(params);
                const result = await client.send(command);
                console.log('Create/Update response:', JSON.stringify(result, null, 2));
                if (!((_a = result.VpcEndpoint) === null || _a === void 0 ? void 0 : _a.VpcEndpointId)) {
                    throw new Error('VPC Endpoint ID not found in response');
                }
                response = {
                    PhysicalResourceId: result.VpcEndpoint.VpcEndpointId,
                    Status: 'SUCCESS',
                    Data: {
                        EndpointId: result.VpcEndpoint.VpcEndpointId,
                        DomainName: props.DomainArn
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
                const params = {
                    VpcEndpointId: physicalId
                };
                const command = new client_opensearch_1.DeleteVpcEndpointCommand(params);
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
    }
    catch (error) {
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
        }
        else {
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
};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3BlbnNlYXJjaC12cGMtZW5kcG9pbnQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9vcGVuc2VhcmNoLXZwYy1lbmRwb2ludC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7OztBQUFBLGtFQU9vQztBQUVwQyw0REFBK0I7QUE2Qi9CLEtBQUssVUFBVSwwQkFBMEIsQ0FBQyxLQUEwQixFQUFFLFFBQWdDO0lBQ3BHLE1BQU0sWUFBWSxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUM7UUFDbEMsTUFBTSxFQUFFLFFBQVEsQ0FBQyxNQUFNLElBQUksU0FBUztRQUNwQyxNQUFNLEVBQUUsUUFBUSxDQUFDLE1BQU0sSUFBSSxpQ0FBaUM7UUFDNUQsa0JBQWtCLEVBQUUsUUFBUSxDQUFDLGtCQUFrQjtRQUMvQyxPQUFPLEVBQUUsS0FBSyxDQUFDLE9BQU87UUFDdEIsU0FBUyxFQUFFLEtBQUssQ0FBQyxTQUFTO1FBQzFCLGlCQUFpQixFQUFFLEtBQUssQ0FBQyxpQkFBaUI7UUFDMUMsSUFBSSxFQUFFLFFBQVEsQ0FBQyxJQUFJO0tBQ3BCLENBQUMsQ0FBQztJQUVILE9BQU8sQ0FBQyxHQUFHLENBQUMscUNBQXFDLEVBQUUsWUFBWSxDQUFDLENBQUM7SUFFakUsSUFBSTtRQUNGLE1BQU0sYUFBYSxHQUFhLE1BQU0sSUFBQSxvQkFBSyxFQUFDLEtBQUssQ0FBQyxXQUFXLEVBQUU7WUFDN0QsTUFBTSxFQUFFLEtBQUs7WUFDYixJQUFJLEVBQUUsWUFBWTtZQUNsQixPQUFPLEVBQUU7Z0JBQ1AsY0FBYyxFQUFFLGtCQUFrQjthQUNuQztTQUNGLENBQUMsQ0FBQztRQUVILElBQUksQ0FBQyxhQUFhLENBQUMsRUFBRSxFQUFFO1lBQ3JCLE1BQU0sSUFBSSxLQUFLLENBQUMsdUJBQXVCLGFBQWEsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxDQUFDO1NBQ2hFO0tBQ0Y7SUFBQyxPQUFPLEtBQUssRUFBRTtRQUNkLE9BQU8sQ0FBQyxLQUFLLENBQUMsMkNBQTJDLEVB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QU0sRUFBRSxRQUFRO2dCQUNoQixNQUFNLEVBQUUsd0JBQXdCO2dCQUNoQyxJQUFJLEVBQUU7b0JBQ0osS0FBSyxFQUFFLHdCQUF3QjtpQkFDaEM7YUFDRixDQUFDO1NBQ0g7UUFFRCw4RUFBOEU7UUFDOUUsTUFBTSwwQkFBMEIsQ0FBQyxLQUFLLEVBQUUsUUFBUSxDQUFDLENBQUM7UUFDbEQsTUFBTSxLQUFLLENBQUMsQ0FBQyxpREFBaUQ7S0FDL0Q7QUFDSCxDQUFDLENBQUEiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBcbiAgT3BlblNlYXJjaENsaWVudCwgXG4gIENyZWF0ZVZwY0VuZHBvaW50Q29tbWFuZCwgXG4gIERlbGV0ZVZwY0VuZHBvaW50Q29tbWFuZCxcbiAgQ3JlYXRlVnBjRW5kcG9pbnRDb21tYW5kSW5wdXQsXG4gIERlbGV0ZVZwY0VuZHBvaW50Q29tbWFuZElucHV0LFxuICBWUENPcHRpb25zXG59IGZyb20gXCJAYXdzLXNkay9jbGllbnQtb3BlbnNlYXJjaFwiO1xuaW1wb3J0IHR5cGUgeyBDb250ZXh0IH0gZnJvbSAnYXdzLWxhbWJkYSc7XG5pbXBvcnQgZmV0Y2ggZnJvbSAnbm9kZS1mZXRjaCc7XG5pbXBvcnQgdHlwZSB7IFJlc3BvbnNlIH0gZnJvbSAnbm9kZS1mZXRjaCc7XG5cbmludGVyZmFjZSBDdXN0b21SZXNvdXJjZUV2ZW50IHtcbiAgUmVxdWVzdFR5cGU6ICdDcmVhdGUnIHwgJ1VwZGF0ZScgfCAnRGVsZXRlJztcbiAgUmVzb3VyY2VQcm9wZXJ0aWVzOiB7XG4gICAgRG9tYWluQXJuOiBzdHJpbmc7XG4gICAgVnBjSWQ6IHN0cmluZztcbiAgICBTdWJuZXRJZHM6IHN0cmluZ1tdO1xuICAgIFNlY3VyaXR5R3JvdXBJZHM6IHN0cmluZ1tdO1xuICB9O1xuICBSZXF1ZXN0SWQ6IHN0cmluZztcbiAgUGh5c2ljYWxSZXNvdXJjZUlkOiBzdHJpbmc7XG4gIExvZ2ljYWxSZXNvdXJjZUlkOiBzdHJpbmc7XG4gIFN0YWNrSWQ6IHN0cmluZztcbiAgUmVzcG9uc2VVUkw6IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIENsb3VkRm9ybWF0aW9uUmVzcG9uc2Uge1xuICBQaHlzaWNhbFJlc291cmNlSWQ6IHN0cmluZztcbiAgRGF0YT86IHtcbiAgICBFbmRwb2ludElkPzogc3RyaW5nO1xuICAgIERvbWFpbk5hbWU/OiBzdHJpbmc7XG4gICAgRXJyb3I/OiBzdHJpbmc7XG4gIH07XG4gIFN0YXR1cz86ICdTVUNDRVNTJyB8ICdGQUlMRUQnO1xuICBSZWFzb24/OiBzdHJpbmc7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHNlbmRDbG91ZEZvcm1hdGlvblJlc3BvbnNlKGV2ZW50OiBDdXN0b21SZXNvdXJjZUV2ZW50LCByZXNwb25zZTogQ2xvdWRGb3JtYXRpb25SZXNwb25zZSk6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCByZXNwb25zZUJvZHkgPSBKU09OLnN0cmluZ2lmeSh7XG4gICAgU3RhdHVzOiByZXNwb25zZS5TdGF0dXMgfHwgJ1NVQ0NFU1MnLFxuICAgIFJlYXNvbjogcmVzcG9uc2UuUmVhc29uIHx8ICdTZWUgQ2xvdWRXYXRjaCBsb2dzIGZvciBkZXRhaWxzJyxcbiAgICBQaHlzaWNhbFJlc291cmNlSWQ6IHJlc3BvbnNlLlBoeXNpY2FsUmVzb3VyY2VJZCxcbiAgICBTdGFja0lkOiBldmVudC5TdGFja0lkLFxuICAgIFJlcXVlc3RJZDogZXZlbnQuUmVxdWVzdElkLFxuICAgIExvZ2ljYWxSZXNvdXJjZUlkOiBldmVudC5Mb2dpY2FsUmVzb3VyY2VJZCxcbiAgICBEYXRhOiByZXNwb25zZS5EYXRhXG4gIH0pO1xuXG4gIGNvbnNvbGUubG9nKCdTZW5kaW5nIHJlc3BvbnNlIHRvIENsb3VkRm9ybWF0aW9uOicsIHJlc3BvbnNlQm9keSk7XG5cbiAgdHJ5IHtcbiAgICBjb25zdCBmZXRjaFJlc3BvbnNlOiBSZXNwb25zZSA9IGF3YWl0IGZldGNoKGV2ZW50LlJlc3BvbnNlVVJMLCB7XG4gICAgICBtZXRob2Q6ICdQVVQnLFxuICAgICAgYm9keTogcmVzcG9uc2VCb2R5LFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIGlmICghZmV0Y2hSZXNwb25zZS5vaykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBIVFRQIGVycm9yISBzdGF0dXM6ICR7ZmV0Y2hSZXNwb25zZS5zdGF0dXN9YCk7XG4gICAgfVxuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIHNlbmRpbmcgcmVzcG9uc2UgdG8gQ2xvdWRGb3JtYXRpb246JywgZXJyb3IpO1xuICAgIHRocm93IGVycm9yO1xuICB9XG59XG5cbmV4cG9ydHMuaGFuZGxlciA9IGFzeW5jIGZ1bmN0aW9uKGV2ZW50OiBDdXN0b21SZXNvdXJjZUV2ZW50LCBjb250ZXh0OiBDb250ZXh0KTogUHJvbWlzZTx2b2lkPiB7XG4gIC8vIEdldCByZWdpb24gZnJvbSBlbnZpcm9ubWVudCB2YXJpYWJsZSBvciBkZWZhdWx0IHRvIHVzLWVhc3QtMVxuICBjb25zdCByZWdpb24gPSBwcm9jZXNzLmVudi5BV1NfUkVHSU9OIHx8ICd1cy1lYXN0LTEnO1xuICBjb25zb2xlLmxvZygnVXNpbmcgcmVnaW9uOicsIHJlZ2lvbik7XG4gIGNvbnNvbGUubG9nKCdFdmVudDonLCBKU09OLnN0cmluZ2lmeShldmVudCwgbnVsbCwgMikpO1xuICBcbiAgY29uc3QgY2xpZW50ID0gbmV3IE9wZW5TZWFyY2hDbGllbnQoeyBcbiAgICByZWdpb24sXG4gICAgbWF4QXR0ZW1wdHM6IDMgLy8gQWRkIHJldHJ5IG1lY2hhbmlzbVxuICB9KTtcbiAgXG4gIGNvbnN0IHByb3BzID0gZXZlbnQuUmVzb3VyY2VQcm9wZXJ0aWVzO1xuICBsZXQgcmVzcG9uc2U6IENsb3VkRm9ybWF0aW9uUmVzcG9uc2U7XG4gIFxuICB0cnkge1xuICAgIHN3aXRjaCAoZXZlbnQuUmVxdWVzdFR5cGUpIHtcbiAgICAgIGNhc2UgJ0NyZWF0ZSc6XG4gICAgICBjYXNlICdVcGRhdGUnOiB7XG4gICAgICAgIGNvbnN0IHZwY09wdGlvbnM6IFZQQ09wdGlvbnMgPSB7XG4gICAgICAgICAgU3VibmV0SWRzOiBwcm9wcy5TdWJuZXRJZHMsXG4gICAgICAgICAgU2VjdXJpdHlHcm91cElkczogcHJvcHMuU2VjdXJpdHlHcm91cElkc1xuICAgICAgICB9O1xuXG4gICAgICAgIGNvbnN0IHBhcmFtczogQ3JlYXRlVnBjRW5kcG9pbnRDb21tYW5kSW5wdXQgPSB7XG4gICAgICAgICAgQ2xpZW50VG9rZW46IGV2ZW50LlJlcXVlc3RJZCxcbiAgICAgICAgICBEb21haW5Bcm46IHByb3BzLkRvbWFpbkFybixcbiAgICAgICAgICBWcGNPcHRpb25zOiB2cGNPcHRpb25zXG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc29sZS5sb2coJ0NyZWF0aW5nL1VwZGF0aW5nIFZQQyBlbmRwb2ludCB3aXRoIHBhcmFtczonLCBKU09OLnN0cmluZ2lmeShwYXJhbXMsIG51bGwsIDIpKTtcblxuICAgICAgICBjb25zdCBjb21tYW5kID0gbmV3IENyZWF0ZVZwY0VuZHBvaW50Q29tbWFuZChwYXJhbXMpO1xuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBjbGllbnQuc2VuZChjb21tYW5kKTtcbiAgICAgICAgY29uc29sZS5sb2coJ0NyZWF0ZS9VcGRhdGUgcmVzcG9uc2U6JywgSlNPTi5zdHJpbmdpZnkocmVzdWx0LCBudWxsLCAyKSk7XG4gICAgICAgIFxuICAgICAgICBpZiAoIXJlc3VsdC5WcGNFbmRwb2ludD8uVnBjRW5kcG9pbnRJZCkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignVlBDIEVuZHBvaW50IElEIG5vdCBmb3VuZCBpbiByZXNwb25zZScpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmVzcG9uc2UgPSB7XG4gICAgICAgICAgUGh5c2ljYWxSZXNvdXJjZUlkOiByZXN1bHQuVnBjRW5kcG9pbnQuVnBjRW5kcG9pbnRJZCxcbiAgICAgICAgICBTdGF0dXM6ICdTVUNDRVNTJyxcbiAgICAgICAgICBEYXRhOiB7XG4gICAgICAgICAgICBFbmRwb2ludElkOiByZXN1bHQuVnBjRW5kcG9pbnQuVnBjRW5kcG9pbnRJZCxcbiAgICAgICAgICAgIERvbWFpbk5hbWU6IHByb3BzLkRvbWFpbkFyblxuICAgICAgICAgIH1cbiAgICAgICAgfTtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG5cbiAgICAgIGNhc2UgJ0RlbGV0ZSc6IHtcbiAgICAgICAgLy8gRm9yIGRlbGV0ZSBvcGVyYXRpb25zLCBhbHdheXMgcmV0dXJuIHRoZSBleGlzdGluZyBQaHlzaWNhbFJlc291cmNlSWRcbiAgICAgICAgY29uc3QgcGh5c2ljYWxJZCA9IGV2ZW50LlBoeXNpY2FsUmVzb3VyY2VJZCB8fCAnZW5kcG9pbnQtaWQtdW5rbm93bic7XG4gICAgICAgIFxuICAgICAgICBpZiAocGh5c2ljYWxJZCA9PT0gJ2VuZHBvaW50LWlkLXVua25vd24nKSB7XG4gICAgICAgICAgY29uc29sZS5sb2coJ05vIGVuZHBvaW50IHRvIGRlbGV0ZScpO1xuICAgICAgICAgIHJlc3BvbnNlID0ge1xuICAgICAgICAgICAgUGh5c2ljYWxSZXNvdXJjZUlkOiBwaHlzaWNhbElkLFxuICAgICAgICAgICAgU3RhdHVzOiAnU1VDQ0VTUydcbiAgICAgICAgICB9O1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG4gICAgICAgIFxuICAgICAgICBjb25zb2xlLmxvZygnRGVsZXRpbmcgVlBDIGVuZHBvaW50OicsIHBoeXNpY2FsSWQpO1xuICAgICAgICBjb25zdCBwYXJhbXM6IERlbGV0ZVZwY0VuZHBvaW50Q29tbWFuZElucHV0ID0ge1xuICAgICAgICAgIFZwY0VuZHBvaW50SWQ6IHBoeXNpY2FsSWRcbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCBjb21tYW5kID0gbmV3IERlbGV0ZVZwY0VuZHBvaW50Q29tbWFuZChwYXJhbXMpO1xuICAgICAgICBhd2FpdCBjbGllbnQuc2VuZChjb21tYW5kKTtcbiAgICAgICAgY29uc29sZS5sb2coJ1N1Y2Nlc3NmdWxseSBkZWxldGVkIFZQQyBlbmRwb2ludCcpO1xuICAgICAgICBcbiAgICAgICAgcmVzcG9uc2UgPSB7XG4gICAgICAgICAgUGh5c2ljYWxSZXNvdXJjZUlkOiBwaHlzaWNhbElkLFxuICAgICAgICAgIFN0YXR1czogJ1NVQ0NFU1MnXG4gICAgICAgIH07XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuXG4gICAgICBkZWZhdWx0OiB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgcmVxdWVzdCB0eXBlOiAke2V2ZW50LlJlcXVlc3RUeXBlfWApO1xuICAgICAgfVxuICAgIH1cblxuICAgIGF3YWl0IHNlbmRDbG91ZEZvcm1hdGlvblJlc3BvbnNlKGV2ZW50LCByZXNwb25zZSk7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgY29uc29sZS5lcnJvcignRXJyb3I6JywgZXJyb3IpO1xuICAgIC8vIEFkZCBtb3JlIGRldGFpbGVkIGVycm9yIGxvZ2dpbmdcbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgY29uc29sZS5lcnJvcignRXJyb3IgbWVzc2FnZTonLCBlcnJvci5tZXNzYWdlKTtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIHN0YWNrOicsIGVycm9yLnN0YWNrKTtcbiAgICAgIFxuICAgICAgcmVzcG9uc2UgPSB7XG4gICAgICAgIFBoeXNpY2FsUmVzb3VyY2VJZDogZXZlbnQuUGh5c2ljYWxSZXNvdXJjZUlkIHx8IGNvbnRleHQuYXdzUmVxdWVzdElkLFxuICAgICAgICBTdGF0dXM6ICdGQUlMRUQnLFxuICAgICAgICBSZWFzb246IGVycm9yLm1lc3NhZ2UsXG4gICAgICAgIERhdGE6IHtcbiAgICAgICAgICBFcnJvcjogZXJyb3IubWVzc2FnZVxuICAgICAgICB9XG4gICAgICB9O1xuICAgIH0gZWxzZSB7XG4gICAgICByZXNwb25zZSA9IHtcbiAgICAgICAgUGh5c2ljYWxSZXNvdXJjZUlkOiBldmVudC5QaHlzaWNhbFJlc291cmNlSWQgfHwgY29udGV4dC5hd3NSZXF1ZXN0SWQsXG4gICAgICAgIFN0YXR1czogJ0ZBSUxFRCcsXG4gICAgICAgIFJlYXNvbjogJ1Vua25vd24gZXJyb3Igb2NjdXJyZWQnLFxuICAgICAgICBEYXRhOiB7XG4gICAgICAgICAgRXJyb3I6ICdVbmtub3duIGVycm9yIG9jY3VycmVkJ1xuICAgICAgICB9XG4gICAgICB9O1xuICAgIH1cblxuICAgIC8vIEFsd2F5cyB0cnkgdG8gc2VuZCByZXNwb25zZSB0byBDbG91ZEZvcm1hdGlvbiwgZXZlbiBpZiB0aGUgb3BlcmF0aW9uIGZhaWxlZFxuICAgIGF3YWl0IHNlbmRDbG91ZEZvcm1hdGlvblJlc3BvbnNlKGV2ZW50LCByZXNwb25zZSk7XG4gICAgdGhyb3cgZXJyb3I7IC8vIFJldGhyb3cgdG8gbWFyayB0aGUgTGFtYmRhIGV4ZWN1dGlvbiBhcyBmYWlsZWRcbiAgfVxufSAiXX0=