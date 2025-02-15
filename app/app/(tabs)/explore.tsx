import { StyleSheet, Image, Platform, EventSubscription } from 'react-native';
import { Audio } from 'expo-av';
import * as Location from 'expo-location';
import { Accelerometer } from 'expo-sensors';
import { useRef } from 'react';
import { useEffect, useState, useCallback } from 'react';
import { Subscription } from 'expo-sensors/build/Pedometer';

import { Collapsible } from '@/components/Collapsible';
import { ExternalLink } from '@/components/ExternalLink';
import ParallaxScrollView from '@/components/ParallaxScrollView';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { TouchableOpacity } from 'react-native';

let recording = new Audio.Recording();

export default function TabTwoScreen() {
  const [{ x, y, z }, setData] = useState({ x: 0, y: 0, z: 0 });
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [isShaking, setIsShaking] = useState(false);
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [emergencyMode, setEmergencyMode] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  const _slow = () => Accelerometer.setUpdateInterval(1000);
  const _fast = () => Accelerometer.setUpdateInterval(16);

  // Initialize audio recording permissions
  useEffect(() => {
    (async () => {
      await Audio.requestPermissionsAsync();
      await Location.requestForegroundPermissionsAsync();
      
      // Get initial location
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High
      });
      setLocation(location);
    })();
  }, []);

  // Function to start emergency recording
  const startEmergencyRecording = async () => {
    if (isRecording) return; // Don't start if already recording
    
    try {
      await recording.prepareToRecordAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      await recording.startAsync();
      setIsRecording(true);
    } catch (err) {
      console.error('Failed to start recording', err);
    }
  };

  // Function to stop recording and send emergency data
  const stopEmergencyRecording = async () => {
    if (!isRecording) return; // Don't stop if not recording
    
    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      
      // Prepare emergency data
      const emergencyData = {
        timestamp: new Date().toISOString(),
        location: {
          latitude: location?.coords.latitude,
          longitude: location?.coords.longitude,
        },
        accelerometerData: { x, y, z },
        audioUri: uri,
        isShaking: isShaking,
      };

      console.log('Emergency Data Ready:', emergencyData);
      await recording._cleanupForUnloadedRecorder();
      setIsRecording(false);
    } catch (err) {
      console.error('Failed to stop recording', err);
    }
  };

  // Modify the existing accelerometer subscription to include emergency detection
  const _subscribe = () => {
    let localEmergencyMode = false; // Local tracking of emergency mode

    setSubscription(Accelerometer.addListener(({x, y, z}) => {
      setData({x, y, z});
      
      const acceleration = Math.sqrt(x * x + y * y + z * z);
      const isCurrentlyShaking = acceleration > 1.5;
      setIsShaking(isCurrentlyShaking);
      
      // If shaking is detected, enter emergency mode
      if (isCurrentlyShaking && !localEmergencyMode) {
        console.log('Entering emergency mode');
        localEmergencyMode = true;
        setEmergencyMode(true);
        startEmergencyRecording();
      } else if (!isCurrentlyShaking && localEmergencyMode) {
        // console.log('Exiting emergency mode');
        // localEmergencyMode = false;
        // setEmergencyMode(false);
        // stopEmergencyRecording();
      }
    }));
  };

  // Update the unsubscribe function
  const _unsubscribe = async () => {
    try {
      await recording.stopAndUnloadAsync();
      await recording._cleanupForUnloadedRecorder();
    } catch (err) {
      console.error('Failed to stop recording cleanup', err);
    }
    subscription?.remove();
    setSubscription(null);
    setEmergencyMode(false);
  };

  useEffect(() => {
    _subscribe();
    return () => {
      recording.stopAndUnloadAsync().finally(() => {
        recording._cleanupForUnloadedRecorder();
      });
      subscription?.remove();
      setSubscription(null);
      setEmergencyMode(false);
    };
  }, []);

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#D0D0D0', dark: '#353636' }}
      headerImage={
        <IconSymbol
          size={310}
          color="#808080"
          name="chevron.left.forwardslash.chevron.right"
          style={styles.headerImage}
        />
      }>
      <ThemedView style={styles.titleContainer}>
        <ThemedText type="title">Emergency Detection</ThemedText>
      </ThemedView>
      
      <ThemedView style={styles.emergencyContainer}>
        <ThemedText>oasjdijsdoisajdioasjdoisajdoij</ThemedText>
        <ThemedText type="subtitle">Status</ThemedText>
        <ThemedText>Emergency Mode: {emergencyMode ? '🚨 ACTIVE' : 'Inactive'}</ThemedText>
        {location && (
          <ThemedText>
            Location: {location.coords.latitude.toFixed(4)}, {location.coords.longitude.toFixed(4)}
          </ThemedText>
        )}
      </ThemedView>

      <ThemedView style={styles.titleContainer}>
        <ThemedText type="title">Explore</ThemedText>
      </ThemedView>
      <ThemedText>IS SHAKING: {isShaking ? 'Yes! 📱' : 'No'}</ThemedText>
      
      <ThemedText>Accelerometer: (in gs where 1g = 9.81 m/s^2)</ThemedText>
      <ThemedText>x: {x}</ThemedText>
      <ThemedText>y: {y}</ThemedText>
      <ThemedText>z: {z}</ThemedText>
      <ThemedText>Shaking: {isShaking ? 'Yes! 📱' : 'No'}</ThemedText>
      <ThemedView>
        <TouchableOpacity onPress={subscription ? _unsubscribe : _subscribe} style={styles.button}>
          <ThemedText>{subscription ? 'On' : 'Off'}</ThemedText>
        </TouchableOpacity>
        <TouchableOpacity onPress={_slow} style={[styles.button, styles.middleButton]}>
          <ThemedText>Slow</ThemedText>
        </TouchableOpacity>
        <TouchableOpacity onPress={_fast} style={styles.button}>
          <ThemedText>Fast</ThemedText>
        </TouchableOpacity>
      </ThemedView>
      <Collapsible title="File-based routing">
        <ThemedText>
          This app has two screens:{' '}
          <ThemedText type="defaultSemiBold">app/(tabs)/index.tsx</ThemedText> and{' '}
          <ThemedText type="defaultSemiBold">app/(tabs)/explore.tsx</ThemedText>
        </ThemedText>
        <ThemedText>
          The layout file in <ThemedText type="defaultSemiBold">app/(tabs)/_layout.tsx</ThemedText>{' '}
          sets up the tab navigator.
        </ThemedText>
        <ExternalLink href="https://docs.expo.dev/router/introduction">
          <ThemedText type="link">Learn more</ThemedText>
        </ExternalLink>
      </Collapsible>
      <Collapsible title="Android, iOS, and web support">
        <ThemedText>
          You can open this project on Android, iOS, and the web. To open the web version, press{' '}
          <ThemedText type="defaultSemiBold">w</ThemedText> in the terminal running this project.
        </ThemedText>
      </Collapsible>
      <Collapsible title="Images">
        <ThemedText>
          For static images, you can use the <ThemedText type="defaultSemiBold">@2x</ThemedText> and{' '}
          <ThemedText type="defaultSemiBold">@3x</ThemedText> suffixes to provide files for
          different screen densities
        </ThemedText>
        <Image source={require('@/assets/images/react-logo.png')} style={{ alignSelf: 'center' }} />
        <ExternalLink href="https://reactnative.dev/docs/images">
          <ThemedText type="link">Learn more</ThemedText>
        </ExternalLink>
      </Collapsible>
      <Collapsible title="Custom fonts">
        <ThemedText>
          Open <ThemedText type="defaultSemiBold">app/_layout.tsx</ThemedText> to see how to load{' '}
          <ThemedText style={{ fontFamily: 'SpaceMono' }}>
            custom fonts such as this one.
          </ThemedText>
        </ThemedText>
        <ExternalLink href="https://docs.expo.dev/versions/latest/sdk/font">
          <ThemedText type="link">Learn more</ThemedText>
        </ExternalLink>
      </Collapsible>
      <Collapsible title="Light and dark mode components">
        <ThemedText>
          This template has light and dark mode support. The{' '}
          <ThemedText type="defaultSemiBold">useColorScheme()</ThemedText> hook lets you inspect
          what the user's current color scheme is, and so you can adjust UI colors accordingly.
        </ThemedText>
        <ExternalLink href="https://docs.expo.dev/develop/user-interface/color-themes/">
          <ThemedText type="link">Learn more</ThemedText>
        </ExternalLink>
      </Collapsible>
      <Collapsible title="Animations">
        <ThemedText>
          This template includes an example of an animated component. The{' '}
          <ThemedText type="defaultSemiBold">components/HelloWave.tsx</ThemedText> component uses
          the powerful <ThemedText type="defaultSemiBold">react-native-reanimated</ThemedText>{' '}
          library to create a waving hand animation.
        </ThemedText>
        {Platform.select({
          ios: (
            <ThemedText>
              The <ThemedText type="defaultSemiBold">components/ParallaxScrollView.tsx</ThemedText>{' '}
              component provides a parallax effect for the header image.
            </ThemedText>
          ),
        })}
      </Collapsible>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  headerImage: {
    color: '#808080',
    bottom: -90,
    left: -35,
    position: 'absolute',
  },
  titleContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  text: {
    textAlign: 'center',
  },
  buttonContainer: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: 15,
  },
  button: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#eee',
    padding: 10,
  },
  middleButton: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: '#ccc',
  },
  emergencyContainer: {
    padding: 15,
    backgroundColor: '#ffebee',
    borderRadius: 8,
    marginVertical: 10,
  },
});
