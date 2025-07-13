import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export class AdsAssetTagsTable extends Construct {
  public readonly table: dynamodb.Table;
  
  constructor(scope: Construct, id: string) {
    super(scope, id);
    
    // Create the DynamoDB table for Ads Asset Tags
    this.table = new dynamodb.Table(this, 'AdsAssetTagsTable', {
      partitionKey: {
        name: 'videoId',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'tagId',
        type: dynamodb.AttributeType.STRING
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    });
    
    // Add GSI for querying by indexId to get all tags for an index
    this.table.addGlobalSecondaryIndex({
      indexName: 'IndexIdGSI',
      partitionKey: {
        name: 'indexId',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'createdAt',
        type: dynamodb.AttributeType.STRING
      },
      projectionType: dynamodb.ProjectionType.ALL
    });
    
    // Add GSI for querying by tag to find all videos with a specific tag
    this.table.addGlobalSecondaryIndex({
      indexName: 'TagGSI',
      partitionKey: {
        name: 'tag',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'confidence',
        type: dynamodb.AttributeType.NUMBER
      },
      projectionType: dynamodb.ProjectionType.ALL
    });
    
    // Add GSI for querying by category to find all tags in a specific category
    this.table.addGlobalSecondaryIndex({
      indexName: 'CategoryGSI',
      partitionKey: {
        name: 'category',
        type: dynamodb.AttributeType.STRING
      },
      sortKey: {
        name: 'createdAt',
        type: dynamodb.AttributeType.STRING
      },
      projectionType: dynamodb.ProjectionType.ALL
    });
    
    // Output the table name for reference
    new cdk.CfnOutput(this, 'AdsAssetTagsTableName', {
      value: this.table.tableName,
      description: 'The name of the DynamoDB table for Ads Asset Tags',
      exportName: 'AdsAssetTagsTableName',
    });
  }
}