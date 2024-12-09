import boto3
import json
from typing import List, Dict

def rerank_documents(query: str, documents: List[Dict[str, str]]) -> Dict:
    """
    Rerank documents using AWS Bedrock Agent Runtime's rerank API.
    
    Args:
        query: The search query
        documents: List of documents to rerank
    
    Returns:
        Dict containing the reranked results
    """
    bedrock_agent = boto3.client(
        service_name='bedrock-agent-runtime',
        region_name='us-east-1'  # specify your region
    )

    # Prepare the reranking request
    request = {
        "queries": [
            {
                "textQuery": {
                    "text": query
                },
                "type": "SEMANTIC"
            }
        ],
        "sources": [
            {
                "type": "INLINE_DOCUMENT",
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
            "type": "BEDROCK",
            "bedrockRerankingConfiguration": {
                "modelConfiguration": {
                    "modelArn": "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-v2",
                    "additionalModelRequestFields": {
                        "maxTokens": 1000
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
            query_results = result.get("citations", [])
            for item in query_results:
                # Extract document ID from the text content
                text = item.get("inlineDocument", {}).get("textDocument", {}).get("text", "")
                doc_id = text.split("[Document ID: ")[-1].rstrip("]") if "[Document ID: " in text else ""
                
                ranked_results.append({
                    "id": doc_id,
                    "text": next((doc["text"] for doc in documents if str(doc.get("id", "")) == doc_id), ""),
                    "score": item.get("score", 0.0)
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
        results = rerank_documents(test_query, test_documents)
        print(json.dumps(results, indent=2))
    except Exception as e:
        print(f"Failed to rerank documents: {str(e)}")
