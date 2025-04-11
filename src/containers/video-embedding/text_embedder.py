import torch
import logging
import numpy as np
from typing import List, Union
from transformers import AutoModel, AutoTokenizer

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class BCETextEmbedder:
    def __init__(
        self,
        model_name: str = "maidalun1020/bce-embedding-base_v1",
        device: str = "cuda" if torch.cuda.is_available() else "cpu",
        max_length: int = 512,
        batch_size: int = 64,
        **kwargs
    ) -> None:
        """Initialize the BCE embedding model for text embedding generation."""
        self.device = device
        self.max_length = max_length
        self.batch_size = batch_size
        
        # Load model and tokenizer
        logger.info(f"Loading BCE embedding model: {model_name} on {device}")
        try:
            self.tokenizer = AutoTokenizer.from_pretrained(model_name)
            self.model = AutoModel.from_pretrained(model_name)
            self.model.to(device)
            self.model.eval()
            logger.info("BCE embedding model loaded successfully")
        except Exception as e:
            logger.error(f"Failed to load BCE embedding model: {str(e)}")
            raise
            
    def get_embeddings(self, texts: Union[str, List[str]]) -> np.ndarray:
        """
        Generate embeddings for a text or list of texts.
        
        Args:
            texts: A single text string or a list of text strings
            
        Returns:
            NumPy array of embeddings
        """
        # Convert single string to list if needed
        if isinstance(texts, str):
            texts = [texts]
            return_single = True
        else:
            return_single = False
            
        try:
            # Tokenize all texts at once
            inputs = self.tokenizer(
                texts, 
                padding=True, 
                truncation=True, 
                max_length=self.max_length, 
                return_tensors="pt"
            )
            
            # Move inputs to device
            inputs_on_device = {k: v.to(self.device) for k, v in inputs.items()}
            
            # Generate embeddings
            with torch.no_grad():
                outputs = self.model(**inputs_on_device, return_dict=True)
                # Use CLS token embedding (first token)
                embeddings = outputs.last_hidden_state[:, 0]
                # Normalize embeddings
                embeddings = embeddings / embeddings.norm(dim=1, keepdim=True)
                # Move to CPU and convert to NumPy
                embeddings = embeddings.cpu().numpy()
            
            # Return single embedding if input was a single string
            if return_single:
                return embeddings[0]
            
            return embeddings
            
        except Exception as e:
            logger.error(f"Error generating text embeddings: {str(e)}")
            raise 