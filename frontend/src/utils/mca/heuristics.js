/**
 * MCA Heuristics Utility
 * Extracting behavioral metrics from MediaPipe FaceMesh landmarks.
 */

// Helper to calculate Euclidean distance between two points
const getDistance = (p1, p2) => {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2) + Math.pow(p1.z - p2.z, 2));
};

/**
 * Calculate Eye Aspect Ratio (EAR)
 * Used to detect blinks and gauge attention/eye contact.
 */
export const calculateEAR = (landmarks) => {
  // Left eye landmarks
  const leftEAR = (
    getDistance(landmarks[160], landmarks[144]) + 
    getDistance(landmarks[158], landmarks[153])
  ) / (2 * getDistance(landmarks[33], landmarks[133]));

  // Right eye landmarks
  const rightEAR = (
    getDistance(landmarks[385], landmarks[380]) + 
    getDistance(landmarks[387], landmarks[373])
  ) / (2 * getDistance(landmarks[362], landmarks[263]));

  return (leftEAR + rightEAR) / 2;
};

/**
 * Calculate Mouth Aspect Ratio (MAR)
 * Used to detect smiles and speaking activity.
 */
export const calculateMAR = (landmarks) => {
  // Inner lips landmarks
  const mar = (
    getDistance(landmarks[81], landmarks[178]) +
    getDistance(landmarks[13], landmarks[14]) +
    getDistance(landmarks[311], landmarks[402])
  ) / (2 * getDistance(landmarks[78], landmarks[308]));

  return mar;
};

/**
 * Estimate Head Pose (Pitch, Yaw, Roll)
 * Simplified heuristic-based estimation.
 */
export const estimateHeadPose = (landmarks) => {
  const nose = landmarks[1];
  const leftEye = landmarks[33];
  const rightEye = landmarks[263];
  const mouthLeft = landmarks[61];
  const mouthRight = landmarks[291];

  // Yaw: Horizontal rotation
  // Comparing distance from nose tip to eye corners
  const leftDist = getDistance(nose, leftEye);
  const rightDist = getDistance(nose, rightEye);
  const yaw = (leftDist - rightDist) / (leftDist + rightDist);

  // Pitch: Vertical rotation
  // Comparing nose position relative to eyes and mouth
  const eyeCenter = {
    x: (leftEye.x + rightEye.x) / 2,
    y: (leftEye.y + rightEye.y) / 2,
    z: (leftEye.z + rightEye.z) / 2
  };
  const mouthCenter = {
    x: (mouthLeft.x + mouthRight.x) / 2,
    y: (mouthLeft.y + mouthRight.y) / 2,
    z: (mouthLeft.z + mouthRight.z) / 2
  };
  
  const upperDist = getDistance(nose, eyeCenter);
  const lowerDist = getDistance(nose, mouthCenter);
  const pitch = (upperDist - lowerDist) / (upperDist + lowerDist);

  // Roll: Tilt
  const roll = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);

  return { yaw, pitch, roll };
};
