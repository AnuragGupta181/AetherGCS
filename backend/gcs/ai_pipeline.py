"""YOLO11-based AI Hazard Detection Pipeline."""
import logging
import time
from typing import Any, Dict, List, Optional, Tuple, Union

import cv2
import numpy as np
from ultralytics import YOLO

logger = logging.getLogger("gcs.ai_pipeline")

class HazardDetector:
    def __init__(self, model_path: str = "yolo11n.pt"):
        self.model_path = model_path
        self.model: Optional[YOLO] = None
        self.is_active: bool = False
        self._load_model()

    def _load_model(self) -> None:
        """Loads the YOLO11 model into memory."""
        try:
            logger.info("Loading YOLO11 model from %s...", self.model_path)
            # YOLO automatically downloads the .pt file if it doesn't exist locally
            self.model = YOLO(self.model_path)
            logger.info("YOLO11 model loaded successfully.")
        except Exception as e:
            logger.error("Failed to load YOLO model: %s", e)

    def toggle(self, state: Optional[Union[bool, str]] = None) -> bool:
        """Toggle or explicitly set the active state of the AI pipeline."""
        if state is not None:
            if isinstance(state, str):
                self.is_active = state.lower() in ("true", "1", "yes")
            else:
                self.is_active = bool(state)
        else:
            self.is_active = not self.is_active
        logger.info("AI Pipeline active state: %s", self.is_active)
        return self.is_active


    def process_frame(self, frame: np.ndarray) -> np.ndarray:
        """Run YOLO inference and draw bounding boxes directly onto the frame."""
        if not self.is_active or self.model is None:
            return frame

        try:
            # Run inference on the frame
            # conf=0.45 avoids noisy low-confidence detections
            # verbose=False prevents console spam per frame
            results = self.model(frame, conf=0.45, verbose=False)

            # Draw the results on the frame
            for result in results:
                boxes = result.boxes
                for box in boxes:
                    # Bounding box coordinates
                    x1, y1, x2, y2 = box.xyxy[0].cpu().numpy().astype(int)
                    # Confidence and Class
                    conf = float(box.conf[0])
                    cls_id = int(box.cls[0])
                    label_name = self.model.names[cls_id]

                    # Define colors based on the class (e.g. green for person, red/orange for fire)
                    color = (0, 255, 65)  # Default: neon green (BGR format for OpenCV)
                    if "fire" in label_name.lower():
                        color = (0, 165, 255)  # Orange
                    elif "flood" in label_name.lower():
                        color = (255, 100, 0)  # Blue
                    elif "ruin" in label_name.lower() or "damage" in label_name.lower():
                        color = (0, 0, 255)  # Red

                    # Draw the bounding box
                    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                    
                    # Draw the label and confidence
                    label_text = f"{label_name.upper()} {conf*100:.1f}%"
                    # Background rectangle for text for better readability
                    (tw, th), _ = cv2.getTextSize(label_text, cv2.FONT_HERSHEY_SIMPLEX, 0.4, 1)
                    cv2.rectangle(frame, (x1, y1 - 20), (x1 + tw, y1), color, -1)
                    cv2.putText(frame, label_text, (x1, y1 - 5),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 0), 1, cv2.LINE_AA)
                    
        except Exception as e:
            logger.error("Error during AI frame processing: %s", e)

        return frame
