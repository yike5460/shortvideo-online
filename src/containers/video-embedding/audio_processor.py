import whisperx
import torch
import os
import logging
from typing import Dict, List, Optional, Union
import tempfile

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class AudioProcessor:
    def __init__(
        self,
        model_name: str = "large-v3-turbo",
        device: str = "cuda" if torch.cuda.is_available() else "cpu",
        compute_type: str = "float16",
        batch_size: int = 16,
        **kwargs
    ) -> None:
        """Initialize the WhisperX model for audio transcription."""
        self.device = device
        self.batch_size = batch_size
        self.compute_type = compute_type
        
        # Set CUDA flags
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.backends.cudnn.allow_tf32 = False
        
        # Load WhisperX model
        logger.info(f"Loading WhisperX model: {model_name} on {device}")
        try:
            self.model = whisperx.load_model(model_name, device, compute_type=compute_type)
            logger.info("WhisperX model loaded successfully")
        except Exception as e:
            logger.error(f"Failed to load WhisperX model: {str(e)}")
            raise
    
    def transcribe_audio(self, audio_file_path: str) -> str:
        """
        Transcribe audio file to text using WhisperX.
        
        Args:
            audio_file_path: Path to the audio file
            
        Returns:
            Concatenated text from all segments
        """
        try:
            logger.info(f"Transcribing audio file: {audio_file_path}")
            
            # Load audio
            audio = whisperx.load_audio(audio_file_path)
            
            # Transcribe with WhisperX
            result = self.model.transcribe(audio, batch_size=self.batch_size)
            
            # Extract and concatenate text from all segments
            segments = result.get("segments", [])
            transcription = " ".join([segment.get("text", "").strip() for segment in segments])
            
            logger.info(f"Transcription completed: {len(segments)} segments found")
            return transcription
        except Exception as e:
            logger.error(f"Error in audio transcription: {str(e)}")
            raise