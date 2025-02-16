import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Accelerometer } from 'expo-sensors';
import * as tf from '@tensorflow/tfjs';

export default function TestModelScreen() {
  const [prediction, setPrediction] = useState<string>('Waiting for data...');
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [dataPoints, setDataPoints] = useState<number[][]>([]);
  const modelRef = useRef<tf.LayersModel | null>(null);
  const subscriptionRef = useRef<any>(null);
  const processCounterRef = useRef(0);

  useEffect(() => {
    let isMounted = true;

    const loadModel = async () => {
      try {
        // Initialize TensorFlow
        await tf.ready();
        
        // Load model files
        console.log('Loading model files');
        const model = await tf.loadLayersModel('https://raw.githubusercontent.com/danielp1218/NSBEHacks2025-App/refs/heads/main/app/assets/model/model.json');
        modelRef.current = model;
        if (isMounted) {
          setIsModelLoaded(true);
        }
      } catch (error) {
        console.error('Error loading model:', error);
      }
    };

    loadModel();

    // Start accelerometer with high frequency
    Accelerometer.setUpdateInterval(10); // 10ms = 100 times per second
    
    subscriptionRef.current = Accelerometer.addListener(accelerometerData => {
      const { x, y, z } = accelerometerData;
      
      setDataPoints(prevPoints => {
        const newPoints = [...prevPoints, [x, y, z]];
        // Keep only the last 500 points
        if (newPoints.length > 500) {
          newPoints.shift();
        }
        return newPoints;
      });

      // Increment process counter
      processCounterRef.current += 1;

      // Process data every 15 updates (adjustable)
      if (processCounterRef.current >= 15 && dataPoints.length === 500) {
        processCounterRef.current = 0;
        processData();
      }
    });

    return () => {
      isMounted = false;
      if (subscriptionRef.current) {
        subscriptionRef.current.remove();
      }
    };
  }, []);

  const processData = async () => {
    if (!modelRef.current || dataPoints.length < 500) return;

    try {
      // Convert data to tensor
      const inputTensor = tf.tensor3d([dataPoints], [1, 500, 3]);
      
      // Get prediction
      const prediction = await modelRef.current.predict(inputTensor) as tf.Tensor;
      const predictionData = await prediction.data();
      
      // Update UI with prediction
      setPrediction(`Prediction: ${predictionData[0]}`);
      
      // Cleanup
      inputTensor.dispose();
      prediction.dispose();
    } catch (error) {
      console.error('Error making prediction:', error);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Model Test</Text>
      <Text style={styles.status}>
        Model Status: {isModelLoaded ? 'Loaded' : 'Loading...'}
      </Text>
      <Text style={styles.status}>
        Data Points: {dataPoints.length}/500
      </Text>
      <Text style={styles.prediction}>{prediction}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  status: {
    fontSize: 16,
    marginBottom: 10,
  },
  prediction: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 20,
  },
});
