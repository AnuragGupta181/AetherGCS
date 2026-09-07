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

                    # Color mapping: Red for person/human, Neon Green for all others
                    label_lower = label_name.lower()
                    if "person" in label_lower or "human" in label_lower:
                        color = (0, 0, 255)  # Red (BGR) for person
                        text_color = (255, 255, 255)  # White text on red
                    else:
                        color = (0, 255, 65)  # Neon green (BGR) for other classes
                        text_color = (0, 0, 0)  # Black text on green

                    # Draw the bounding box
                    cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                    
                    # Draw the label and confidence
                    label_text = f"{label_name.upper()} {conf*100:.1f}%"
                    # Background rectangle for text for better readability
                    (tw, th), _ = cv2.getTextSize(label_text, cv2.FONT_HERSHEY_SIMPLEX, 0.4, 1)
                    bg_y1 = max(0, y1 - 20)
                    bg_y2 = y1 if y1 >= 20 else y1 + th + 10
                    text_y = y1 - 5 if y1 >= 20 else y1 + th + 5
                    cv2.rectangle(frame, (x1, bg_y1), (x1 + tw + 4, bg_y2), color, -1)
                    cv2.putText(frame, label_text, (x1 + 2, text_y),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.4, text_color, 1, cv2.LINE_AA)
                    
        except Exception as e:
            logger.error("Error during AI frame processing: %s", e)

        return frame
