"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_opensearch_1 = require("@aws-sdk/client-opensearch");
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
        const fetch = await Promise.resolve().then(() => __importStar(require('node-fetch')));
        await fetch.default(event.ResponseURL, {
            method: 'PUT',
            body: responseBody,
            headers: {
                'Content-Type': 'application/json',
            },
        });
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
                    DomainName: props.DomainName,
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib3BlbnNlYXJjaC12cGMtZW5kcG9pbnQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9vcGVuc2VhcmNoLXZwYy1lbmRwb2ludC50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsa0VBT29DO0FBNEJwQyxLQUFLLFVBQVUsMEJBQTBCLENBQUMsS0FBMEIsRUFBRSxRQUFnQztJQUNwRyxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDO1FBQ2xDLE1BQU0sRUFBRSxRQUFRLENBQUMsTUFBTSxJQUFJLFNBQVM7UUFDcEMsTUFBTSxFQUFFLFFBQVEsQ0FBQyxNQUFNLElBQUksaUNBQWlDO1FBQzVELGtCQUFrQixFQUFFLFFBQVEsQ0FBQyxrQkFBa0I7UUFDL0MsT0FBTyxFQUFFLEtBQUssQ0FBQyxPQUFPO1FBQ3RCLFNBQVMsRUFBRSxLQUFLLENBQUMsU0FBUztRQUMxQixpQkFBaUIsRUFBRSxLQUFLLENBQUMsaUJBQWlCO1FBQzFDLElBQUksRUFBRSxRQUFRLENBQUMsSUFBSTtLQUNwQixDQUFDLENBQUM7SUFFSCxPQUFPLENBQUMsR0FBRyxDQUFDLHFDQUFxQyxFQUFFLFlBQVksQ0FBQyxDQUFDO0lBRWpFLElBQUk7UUFDRixNQUFNLEtBQUssR0FBRyx3REFBYSxZQUFZLEdBQUMsQ0FBQztRQUN6QyxNQUFNLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLFdBQVcsRUFBRTtZQUNyQyxNQUFNLEVBQUUsS0FBSztZQUNiLElBQUksRUFBRSxZQUFZO1lBQ2xCLE9BQU8sRUFBRTtnQkFDUCxjQUFjLEVBQUUsa0JBQWtCO2FBQ25DO1NBQ0YsQ0FBQyxDQUFDO0tBQ0o7SUFBQyxPQUFPLEtBQUssRUFBRTtRQUNkLE9BQU8sQ0FBQyxLQUFLLENBQUMsMkNBQTJDLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFDbEUsTUFBTSxLQUFLLENBQUM7S0FDYjtBQUNILENBQUM7QUFFRCxPQUFPLENB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QUFFLHdCQUF3QjtpQkFDaEM7YUFDRixDQUFDO1NBQ0g7UUFFRCw4RUFBOEU7UUFDOUUsTUFBTSwwQkFBMEIsQ0FBQyxLQUFLLEVBQUUsUUFBUSxDQUFDLENBQUM7UUFDbEQsTUFBTSxLQUFLLENBQUMsQ0FBQyxpREFBaUQ7S0FDL0Q7QUFDSCxDQUFDLENBQUEiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBcbiAgT3BlblNlYXJjaENsaWVudCwgXG4gIENyZWF0ZVZwY0VuZHBvaW50Q29tbWFuZCwgXG4gIERlbGV0ZVZwY0VuZHBvaW50Q29tbWFuZCxcbiAgQ3JlYXRlVnBjRW5kcG9pbnRDb21tYW5kSW5wdXQsXG4gIERlbGV0ZVZwY0VuZHBvaW50Q29tbWFuZElucHV0LFxuICBWUENPcHRpb25zXG59IGZyb20gXCJAYXdzLXNkay9jbGllbnQtb3BlbnNlYXJjaFwiO1xuaW1wb3J0IHR5cGUgeyBDb250ZXh0IH0gZnJvbSAnYXdzLWxhbWJkYSc7XG5cbmludGVyZmFjZSBDdXN0b21SZXNvdXJjZUV2ZW50IHtcbiAgUmVxdWVzdFR5cGU6ICdDcmVhdGUnIHwgJ1VwZGF0ZScgfCAnRGVsZXRlJztcbiAgUmVzb3VyY2VQcm9wZXJ0aWVzOiB7XG4gICAgRG9tYWluTmFtZTogc3RyaW5nO1xuICAgIFZwY0lkOiBzdHJpbmc7XG4gICAgU3VibmV0SWRzOiBzdHJpbmdbXTtcbiAgICBTZWN1cml0eUdyb3VwSWRzOiBzdHJpbmdbXTtcbiAgfTtcbiAgUmVxdWVzdElkOiBzdHJpbmc7XG4gIFBoeXNpY2FsUmVzb3VyY2VJZDogc3RyaW5nO1xuICBMb2dpY2FsUmVzb3VyY2VJZDogc3RyaW5nO1xuICBTdGFja0lkOiBzdHJpbmc7XG4gIFJlc3BvbnNlVVJMOiBzdHJpbmc7XG59XG5cbmludGVyZmFjZSBDbG91ZEZvcm1hdGlvblJlc3BvbnNlIHtcbiAgUGh5c2ljYWxSZXNvdXJjZUlkOiBzdHJpbmc7XG4gIERhdGE/OiB7XG4gICAgRW5kcG9pbnRJZD86IHN0cmluZztcbiAgICBEb21haW5OYW1lPzogc3RyaW5nO1xuICB9O1xuICBTdGF0dXM/OiAnU1VDQ0VTUycgfCAnRkFJTEVEJztcbiAgUmVhc29uPzogc3RyaW5nO1xufVxuXG5hc3luYyBmdW5jdGlvbiBzZW5kQ2xvdWRGb3JtYXRpb25SZXNwb25zZShldmVudDogQ3VzdG9tUmVzb3VyY2VFdmVudCwgcmVzcG9uc2U6IENsb3VkRm9ybWF0aW9uUmVzcG9uc2UpOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3QgcmVzcG9uc2VCb2R5ID0gSlNPTi5zdHJpbmdpZnkoe1xuICAgIFN0YXR1czogcmVzcG9uc2UuU3RhdHVzIHx8ICdTVUNDRVNTJyxcbiAgICBSZWFzb246IHJlc3BvbnNlLlJlYXNvbiB8fCAnU2VlIENsb3VkV2F0Y2ggbG9ncyBmb3IgZGV0YWlscycsXG4gICAgUGh5c2ljYWxSZXNvdXJjZUlkOiByZXNwb25zZS5QaHlzaWNhbFJlc291cmNlSWQsXG4gICAgU3RhY2tJZDogZXZlbnQuU3RhY2tJZCxcbiAgICBSZXF1ZXN0SWQ6IGV2ZW50LlJlcXVlc3RJZCxcbiAgICBMb2dpY2FsUmVzb3VyY2VJZDogZXZlbnQuTG9naWNhbFJlc291cmNlSWQsXG4gICAgRGF0YTogcmVzcG9uc2UuRGF0YVxuICB9KTtcblxuICBjb25zb2xlLmxvZygnU2VuZGluZyByZXNwb25zZSB0byBDbG91ZEZvcm1hdGlvbjonLCByZXNwb25zZUJvZHkpO1xuXG4gIHRyeSB7XG4gICAgY29uc3QgZmV0Y2ggPSBhd2FpdCBpbXBvcnQoJ25vZGUtZmV0Y2gnKTtcbiAgICBhd2FpdCBmZXRjaC5kZWZhdWx0KGV2ZW50LlJlc3BvbnNlVVJMLCB7XG4gICAgICBtZXRob2Q6ICdQVVQnLFxuICAgICAgYm9keTogcmVzcG9uc2VCb2R5LFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgfSxcbiAgICB9KTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBjb25zb2xlLmVycm9yKCdFcnJvciBzZW5kaW5nIHJlc3BvbnNlIHRvIENsb3VkRm9ybWF0aW9uOicsIGVycm9yKTtcbiAgICB0aHJvdyBlcnJvcjtcbiAgfVxufVxuXG5leHBvcnRzLmhhbmRsZXIgPSBhc3luYyBmdW5jdGlvbihldmVudDogQ3VzdG9tUmVzb3VyY2VFdmVudCwgY29udGV4dDogQ29udGV4dCk6IFByb21pc2U8dm9pZD4ge1xuICAvLyBHZXQgcmVnaW9uIGZyb20gZW52aXJvbm1lbnQgdmFyaWFibGUgb3IgZGVmYXVsdCB0byB1cy1lYXN0LTFcbiAgY29uc3QgcmVnaW9uID0gcHJvY2Vzcy5lbnYuQVdTX1JFR0lPTiB8fCAndXMtZWFzdC0xJztcbiAgY29uc29sZS5sb2coJ1VzaW5nIHJlZ2lvbjonLCByZWdpb24pO1xuICBjb25zb2xlLmxvZygnRXZlbnQ6JywgSlNPTi5zdHJpbmdpZnkoZXZlbnQsIG51bGwsIDIpKTtcbiAgXG4gIGNvbnN0IGNsaWVudCA9IG5ldyBPcGVuU2VhcmNoQ2xpZW50KHsgXG4gICAgcmVnaW9uLFxuICAgIG1heEF0dGVtcHRzOiAzIC8vIEFkZCByZXRyeSBtZWNoYW5pc21cbiAgfSk7XG4gIFxuICBjb25zdCBwcm9wcyA9IGV2ZW50LlJlc291cmNlUHJvcGVydGllcztcbiAgbGV0IHJlc3BvbnNlOiBDbG91ZEZvcm1hdGlvblJlc3BvbnNlO1xuICBcbiAgdHJ5IHtcbiAgICBzd2l0Y2ggKGV2ZW50LlJlcXVlc3RUeXBlKSB7XG4gICAgICBjYXNlICdDcmVhdGUnOlxuICAgICAgY2FzZSAnVXBkYXRlJzoge1xuICAgICAgICBjb25zdCB2cGNPcHRpb25zOiBWUENPcHRpb25zID0ge1xuICAgICAgICAgIFN1Ym5ldElkczogcHJvcHMuU3VibmV0SWRzLFxuICAgICAgICAgIFNlY3VyaXR5R3JvdXBJZHM6IHByb3BzLlNlY3VyaXR5R3JvdXBJZHNcbiAgICAgICAgfTtcblxuICAgICAgICBjb25zdCBwYXJhbXM6IENyZWF0ZVZwY0VuZHBvaW50Q29tbWFuZElucHV0ID0ge1xuICAgICAgICAgIENsaWVudFRva2VuOiBldmVudC5SZXF1ZXN0SWQsXG4gICAgICAgICAgRG9tYWluTmFtZTogcHJvcHMuRG9tYWluTmFtZSxcbiAgICAgICAgICBWcGNPcHRpb25zOiB2cGNPcHRpb25zXG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc29sZS5sb2coJ0NyZWF0aW5nL1VwZGF0aW5nIFZQQyBlbmRwb2ludCB3aXRoIHBhcmFtczonLCBKU09OLnN0cmluZ2lmeShwYXJhbXMsIG51bGwsIDIpKTtcblxuICAgICAgICBjb25zdCBjb21tYW5kID0gbmV3IENyZWF0ZVZwY0VuZHBvaW50Q29tbWFuZChwYXJhbXMpO1xuICAgICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBjbGllbnQuc2VuZChjb21tYW5kKTtcbiAgICAgICAgY29uc29sZS5sb2coJ0NyZWF0ZS9VcGRhdGUgcmVzcG9uc2U6JywgSlNPTi5zdHJpbmdpZnkocmVzdWx0LCBudWxsLCAyKSk7XG4gICAgICAgIFxuICAgICAgICBpZiAoIXJlc3VsdC5WcGNFbmRwb2ludD8uVnBjRW5kcG9pbnRJZCkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignVlBDIEVuZHBvaW50IElEIG5vdCBmb3VuZCBpbiByZXNwb25zZScpO1xuICAgICAgICB9XG5cbiAgICAgICAgcmVzcG9uc2UgPSB7XG4gICAgICAgICAgUGh5c2ljYWxSZXNvdXJjZUlkOiByZXN1bHQuVnBjRW5kcG9pbnQuVnBjRW5kcG9pbnRJZCxcbiAgICAgICAgICBTdGF0dXM6ICdTVUNDRVNTJyxcbiAgICAgICAgICBEYXRhOiB7XG4gICAgICAgICAgICBFbmRwb2ludElkOiByZXN1bHQuVnBjRW5kcG9pbnQuVnBjRW5kcG9pbnRJZCxcbiAgICAgICAgICAgIERvbWFpbk5hbWU6IHByb3BzLkRvbWFpbk5hbWVcbiAgICAgICAgICB9XG4gICAgICAgIH07XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuXG4gICAgICBjYXNlICdEZWxldGUnOiB7XG4gICAgICAgIC8vIEZvciBkZWxldGUgb3BlcmF0aW9ucywgYWx3YXlzIHJldHVybiB0aGUgZXhpc3RpbmcgUGh5c2ljYWxSZXNvdXJjZUlkXG4gICAgICAgIGNvbnN0IHBoeXNpY2FsSWQgPSBldmVudC5QaHlzaWNhbFJlc291cmNlSWQgfHwgJ2VuZHBvaW50LWlkLXVua25vd24nO1xuICAgICAgICBcbiAgICAgICAgaWYgKHBoeXNpY2FsSWQgPT09ICdlbmRwb2ludC1pZC11bmtub3duJykge1xuICAgICAgICAgIGNvbnNvbGUubG9nKCdObyBlbmRwb2ludCB0byBkZWxldGUnKTtcbiAgICAgICAgICByZXNwb25zZSA9IHtcbiAgICAgICAgICAgIFBoeXNpY2FsUmVzb3VyY2VJZDogcGh5c2ljYWxJZCxcbiAgICAgICAgICAgIFN0YXR1czogJ1NVQ0NFU1MnXG4gICAgICAgICAgfTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBcbiAgICAgICAgY29uc29sZS5sb2coJ0RlbGV0aW5nIFZQQyBlbmRwb2ludDonLCBwaHlzaWNhbElkKTtcbiAgICAgICAgY29uc3QgcGFyYW1zOiBEZWxldGVWcGNFbmRwb2ludENvbW1hbmRJbnB1dCA9IHtcbiAgICAgICAgICBWcGNFbmRwb2ludElkOiBwaHlzaWNhbElkXG4gICAgICAgIH07XG5cbiAgICAgICAgY29uc3QgY29tbWFuZCA9IG5ldyBEZWxldGVWcGNFbmRwb2ludENvbW1hbmQocGFyYW1zKTtcbiAgICAgICAgYXdhaXQgY2xpZW50LnNlbmQoY29tbWFuZCk7XG4gICAgICAgIGNvbnNvbGUubG9nKCdTdWNjZXNzZnVsbHkgZGVsZXRlZCBWUEMgZW5kcG9pbnQnKTtcbiAgICAgICAgXG4gICAgICAgIHJlc3BvbnNlID0ge1xuICAgICAgICAgIFBoeXNpY2FsUmVzb3VyY2VJZDogcGh5c2ljYWxJZCxcbiAgICAgICAgICBTdGF0dXM6ICdTVUNDRVNTJ1xuICAgICAgICB9O1xuICAgICAgICBicmVhaztcbiAgICAgIH1cblxuICAgICAgZGVmYXVsdDoge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIHJlcXVlc3QgdHlwZTogJHtldmVudC5SZXF1ZXN0VHlwZX1gKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBhd2FpdCBzZW5kQ2xvdWRGb3JtYXRpb25SZXNwb25zZShldmVudCwgcmVzcG9uc2UpO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yOicsIGVycm9yKTtcbiAgICAvLyBBZGQgbW9yZSBkZXRhaWxlZCBlcnJvciBsb2dnaW5nXG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgRXJyb3IpIHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0Vycm9yIG1lc3NhZ2U6JywgZXJyb3IubWVzc2FnZSk7XG4gICAgICBjb25zb2xlLmVycm9yKCdFcnJvciBzdGFjazonLCBlcnJvci5zdGFjayk7XG4gICAgICBcbiAgICAgIHJlc3BvbnNlID0ge1xuICAgICAgICBQaHlzaWNhbFJlc291cmNlSWQ6IGV2ZW50LlBoeXNpY2FsUmVzb3VyY2VJZCB8fCBjb250ZXh0LmF3c1JlcXVlc3RJZCxcbiAgICAgICAgU3RhdHVzOiAnRkFJTEVEJyxcbiAgICAgICAgUmVhc29uOiBlcnJvci5tZXNzYWdlLFxuICAgICAgICBEYXRhOiB7XG4gICAgICAgICAgRXJyb3I6IGVycm9yLm1lc3NhZ2VcbiAgICAgICAgfVxuICAgICAgfTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmVzcG9uc2UgPSB7XG4gICAgICAgIFBoeXNpY2FsUmVzb3VyY2VJZDogZXZlbnQuUGh5c2ljYWxSZXNvdXJjZUlkIHx8IGNvbnRleHQuYXdzUmVxdWVzdElkLFxuICAgICAgICBTdGF0dXM6ICdGQUlMRUQnLFxuICAgICAgICBSZWFzb246ICdVbmtub3duIGVycm9yIG9jY3VycmVkJyxcbiAgICAgICAgRGF0YToge1xuICAgICAgICAgIEVycm9yOiAnVW5rbm93biBlcnJvciBvY2N1cnJlZCdcbiAgICAgICAgfVxuICAgICAgfTtcbiAgICB9XG5cbiAgICAvLyBBbHdheXMgdHJ5IHRvIHNlbmQgcmVzcG9uc2UgdG8gQ2xvdWRGb3JtYXRpb24sIGV2ZW4gaWYgdGhlIG9wZXJhdGlvbiBmYWlsZWRcbiAgICBhd2FpdCBzZW5kQ2xvdWRGb3JtYXRpb25SZXNwb25zZShldmVudCwgcmVzcG9uc2UpO1xuICAgIHRocm93IGVycm9yOyAvLyBSZXRocm93IHRvIG1hcmsgdGhlIExhbWJkYSBleGVjdXRpb24gYXMgZmFpbGVkXG4gIH1cbn0gIl19