# Check the latest release feture in https://aws.amazon.com/blogs/machine-learning/cohere-rerank-3-5-is-now-available-in-amazon-bedrock-through-rerank-api/
import boto3
import json
from typing import List, Dict

bedrock_agent = boto3.client(
    service_name='bedrock-agent-runtime',
    region_name='us-west-2'  # specify your region
)

def rerank_documents(bedrock_agent: boto3.client, query: str, documents: List[Dict[str, str]]) -> Dict:
    """
    Rerank documents using AWS Bedrock Agent Runtime's rerank API.
    
    Args:
        query: The search query
        documents: List of documents to rerank
    
    Returns:
        Dict containing the reranked results
    """


    # Prepare the reranking request
    request = {
        "queries": [
            {
                "textQuery": {
                    "text": query
                },
                # Other possible parameters: SEMANTIC_SEARCH, KEYWORD_SEARCH
                "type": "TEXT"
            }
        ],
        "sources": [
            {
                # Other possible parameters: INLINE_DOCUMENT, INLINE
                "type": "INLINE",
                "inlineDocumentSource": {
                    "type": "TEXT",
                    "textDocument": {
                        "text": f"{doc['text']} [Document ID: {doc.get('id', f'doc_{i}')}]"
                    }
                }
            }
            for i, doc in enumerate(documents)
        ],
        "rerankingConfiguration": {
            "type": "BEDROCK_RERANKING_MODEL",
            "bedrockRerankingConfiguration": {
                "modelConfiguration": {
                    "modelArn": "arn:aws:bedrock:us-west-2::foundation-model/cohere.rerank-v3-5:0",
                    # "modelArn": "arn:aws:bedrock:us-west-2::foundation-model/amazon.rerank-v1:0",
                    "additionalModelRequestFields": {
                        "max_tokens_per_doc": 1000
                    }
                },
                "numberOfResults": min(len(documents), 10)
            }
        }
    }

    try:
        # Call the rerank API with unpacked parameters
        response = bedrock_agent.rerank(
            queries=request["queries"],
            sources=request["sources"],
            rerankingConfiguration=request["rerankingConfiguration"]
        )
        # Transform the response into a more usable format
        ranked_results = []
        for result in response.get("results", []):
            index = result.get("index", 0)
            if index < len(documents):
                doc = documents[index]
                ranked_results.append({
                    "id": doc.get("id", f"doc_{index}"),
                    "text": doc.get("text", ""),
                    "score": result.get("relevanceScore", 0.0)
                })
        
        return {
            "results": ranked_results,
            "metadata": {
                "total_documents": len(documents),
                "query": query
            }
        }

    except Exception as e:
        print(f"Error during reranking: {str(e)}")
        raise

if __name__ == "__main__":
    # Example usage
    test_documents = [
        {
            "id": "doc1",
            "text": "The quick brown fox jumps over the lazy dog."
        },
        {
            "id": "doc2",
            "text": "A lazy dog sleeps in the sun while a fox watches."
        },
        {
            "id": "doc3",
            "text": "The clever fox outsmarts the hunting dogs."
        }
    ]

    test_query = "fox and dog interaction"
    
    try:
        results = rerank_documents(bedrock_agent, test_query, test_documents)
        print(json.dumps(results, indent=2))
    except Exception as e:
        print(f"Failed to rerank documents: {str(e)}")
