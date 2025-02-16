import * as tf from '@tensorflow/tfjs';
import { useEffect } from 'react';

export default function RootLayout() {
  // Initialize TensorFlow
  useEffect(() => {
    const initTF = async () => {
      await tf.ready();
    };
    initTF();
  }, []);

  return null; // Or your actual layout component
} 