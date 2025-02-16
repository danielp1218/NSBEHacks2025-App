// REPEATEDLY POLL FOR ALL OTHER INCIDENTS TO COMPARE DISTANCES TO SEE WHETHER NEED OT ALERT
// EVERY 5S

import { StyleSheet, Image, Platform, EventSubscription } from 'react-native';
import { Audio } from 'expo-av';
import * as Location from 'expo-location';
import { Accelerometer } from 'expo-sensors';
import { useRef } from 'react';
import { useEffect, useState, useCallback } from 'react';
import { Subscription } from 'expo-sensors/build/Pedometer';
import * as LocalAuthentication from 'expo-local-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, TextInput, Modal } from 'react-native';
import * as Contacts from 'expo-contacts';

import { Collapsible } from '@/components/Collapsible';
import { ExternalLink } from '@/components/ExternalLink';
import ParallaxScrollView from '@/components/ParallaxScrollView';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { ScrollView, TouchableOpacity } from 'react-native';

let recording = new Audio.Recording();

export default function TabTwoScreen() {
  const [{ x, y, z }, setData] = useState({ x: 0, y: 0, z: 0 });
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [isShaking, setIsShaking] = useState(false);
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [emergencyMode, setEmergencyMode] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [password, setPassword] = useState('');
  const [hasPassword, setHasPassword] = useState(false);
  const DEFAULT_PASSWORD = 'guardian';
  const BASE_URL = 'https://nsbe-hacks-2025-dashboard.vercel.app/api';
  // ?lastPollTime=timestampms...
  const GET_INCIDENTS_ENDPOINT = `${BASE_URL}/get-new-incidents`;
  const GET_UNRESOLVED_INCIDENTS_ENDPOINT = `${BASE_URL}/get-unresolved-incidents`;
  // incidentName, victimName, incidentTime, gpsCoordinates, status, emergencyContacts:[{fullName:...,phoneNumber:...,email:...}] --------victimPhoneNumber??
  const CREATE_INCIDENT_ENDPOINT = `${BASE_URL}/create-incident`;
  // id, incidentEndTime
  const RESOLVE_INCIDENT_ENDPOINT = `${BASE_URL}/resolve-incident`;
  // id, status
  const UPDATE_INCIDENT_STATUS_ENDPOINT = `${BASE_URL}/update-incident-status`;
  // incidentId, gpsCoordinates, locationTime
  const ADD_INCIDENT_LOCATION_ENDPOINT = `${BASE_URL}/add-incident-location`;
  // incidentId, audioUri, audioDuration
  const ADD_INCIDENT_AUDIO_ENDPOINT = `${BASE_URL}/add-incident-audio`;

  // id, latitude, longitude


  const [recordingInterval, setRecordingInterval] = useState<NodeJS.Timeout | null>(null);
  const RECORDING_DURATION = 10000; // 10 seconds in milliseconds
  const [hasCreatedIncident, setHasCreatedIncident] = useState<boolean>(false);
  const [fullName, setFullName] = useState('');
  const [emergencyContacts, setEmergencyContacts] = useState<Contacts.Contact[]>([]);
  const [showContactsModal, setShowContactsModal] = useState(false);
  const [contactsList, setContactsList] = useState<Contacts.Contact[]>([]);

  // const _slow = () => Accelerometer.setUpdateInterval(1000);
  // const _fast = () => Accelerometer.setUpdateInterval(16);

  // Add near other state variables
  const [locationInterval, setLocationInterval] = useState<NodeJS.Timeout | null>(null);
  const [incidentId, setIncidentId] = useState<string | null>(null);
  const LOCATION_UPDATE_INTERVAL = 2000; // 2 seconds

  // Initialize audio recording permissions
  useEffect(() => {
    (async () => {
      Accelerometer.setUpdateInterval(350);
      await Audio.requestPermissionsAsync();
      await Location.requestForegroundPermissionsAsync();
      
      // Get initial location
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High
      });
      setLocation(location);
    })();
  }, []);

  // Add this function before startIntervalRecording
  const recordAndSend = async () => {
    try {
      // Start new recording
      await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      await recording.startAsync();
      setIsRecording(true);

      // Wait for 10 seconds
      await new Promise(resolve => setTimeout(resolve, RECORDING_DURATION));

      // Stop recording and get URI
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      
      // Reset recording for next interval
      await recording._cleanupForUnloadedRecorder();
      recording = new Audio.Recording();
      
      // Start next recording if still in emergency mode
      if (emergencyMode) {
        recordAndSend();
      } else {
        setIsRecording(false);
      }
    } catch (err) {
      console.error('Error in record and send cycle:', err);
      setIsRecording(false);
    }
  };

  // Function to start interval recording
  const startIntervalRecording = async () => {
    if (isRecording) return;
    
    try {
      // Send initial incident creation
      const response = await fetch(CREATE_INCIDENT_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          incidentName: 'Attack',
          victimName: fullName || 'Unknown',
          incidentTime: new Date().getUTCMilliseconds(),
          gpsCoordinates: {
            latitude: location?.coords.latitude || 43.6594719,
            longitude: location?.coords.longitude || -79.3978135,
          },
          emergencyContacts: emergencyContacts.map(contact => ({
            fullName: contact.name,
            phoneNumber: contact.phoneNumbers?.[0]?.number,
            email: contact.emails?.[0]?.email,
          })),
        }),
      });

      const data = await response.json();
      setIncidentId(data.id); // Store the incident ID

      // Start location tracking
      const locationTracker = setInterval(async () => {
        try {
          const currentLocation = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High
          });

          // Send location update
          await fetch(ADD_INCIDENT_LOCATION_ENDPOINT, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              incidentId: data.id,
              gpsCoordinates: {
                latitude: currentLocation.coords.latitude,
                longitude: currentLocation.coords.longitude,
              },
              locationTime: new Date().getTime(),
            }),
          });

          setLocation(currentLocation);
        } catch (err) {
          console.error('Failed to update location:', err);
        }
      }, LOCATION_UPDATE_INTERVAL);

      setLocationInterval(locationTracker);
    } catch (err) {
      console.error('Failed to start incident:', err);
    }

    // Start the recording cycle
    recordAndSend();
  };

  // Function to start emergency recording
  const startEmergencyRecording = async () => {
    if (isRecording) return;
    startIntervalRecording();
  };

  // Function to stop recording and send emergency data
  const stopEmergencyRecording = async () => {
    if (!isRecording) return;
    
    try {
      // Stop location tracking
      if (locationInterval) {
        clearInterval(locationInterval);
        setLocationInterval(null);
      }

      // Stop recording
      await recording.stopAndUnloadAsync();
      await recording._cleanupForUnloadedRecorder();
      recording = new Audio.Recording();
      setIsRecording(false);

      // Mark incident as resolved if we have an ID
      if (incidentId) {
        await fetch(RESOLVE_INCIDENT_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            id: incidentId,
            incidentEndTime: new Date().getTime(),
          }),
        });
        setIncidentId(null);
      }
    } catch (err) {
      console.error('Failed to stop recording:', err);
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
    setIsRecording(false);
  };

  useEffect(() => {
    _subscribe();
    return () => {
      if (isRecording) {
        recording.stopAndUnloadAsync().finally(() => {
          recording._cleanupForUnloadedRecorder();
        });
      }
      if (locationInterval) {
        clearInterval(locationInterval);
      }
      subscription?.remove();
      setSubscription(null);
      setEmergencyMode(false);
      setIsRecording(false);
      setLocationInterval(null);
    };
  }, []);

  useEffect(() => {
    checkPassword();
  }, []);

  useEffect(() => {
    loadUserName();
  }, []);

  useEffect(() => {
    loadEmergencyContacts();
  }, []);

  const checkPassword = async () => {
    const storedPassword = await AsyncStorage.getItem('emergencyPassword');
    if (!storedPassword) {
      // Set default password if none exists
      await AsyncStorage.setItem('emergencyPassword', DEFAULT_PASSWORD);
      setHasPassword(true);
    } else {
      setHasPassword(true);
    }
  };

  const handleSetPassword = async () => {
    try {
      const auth = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Authenticate to set emergency password'
      });
      
      if (auth.success) {
        await AsyncStorage.setItem('emergencyPassword', password);
        setHasPassword(true);
        setShowPasswordModal(false);
        setPassword('');
      }
    } catch (err) {
      console.error('Failed to set password:', err);
    }
  };

  const handleImOk = async (attemptedPassword: string) => {
    const storedPassword = await AsyncStorage.getItem('emergencyPassword');
    if (attemptedPassword === storedPassword) {
      stopEmergencyRecording();
      setEmergencyMode(false);
      setShowPasswordModal(false);
      setPassword('');
    } else {
      Alert.alert('Incorrect Password', 'Please try again');
    }
  };

  const loadUserName = async () => {
    try {
      const storedName = await AsyncStorage.getItem('userName');
      if (storedName) {
        setFullName(storedName);
      }
    } catch (err) {
      console.error('Failed to load user name:', err);
    }
  };

  const handleSaveName = async (newName: string) => {
    try {
      await AsyncStorage.setItem('userName', newName);
      setFullName(newName);
    } catch (err) {
      console.error('Failed to save user name:', err);
    }
  };

  const loadEmergencyContacts = async () => {
    try {
      const storedContacts = await AsyncStorage.getItem('emergencyContacts');
      if (storedContacts) {
        setEmergencyContacts(JSON.parse(storedContacts));
      }
    } catch (err) {
      console.error('Failed to load emergency contacts:', err);
    }
  };

  const handlePickContact = async () => {
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status === 'granted') {
        const { data } = await Contacts.getContactsAsync({
          fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name],
        });
        setContactsList(data);
        setShowContactsModal(true);
      } else {
        Alert.alert('Permission required', 'Please allow access to your contacts to add emergency contacts.');
      }
    } catch (err) {
      console.error('Error accessing contacts:', err);
    }
  };

  const saveEmergencyContacts = async (contacts: Contacts.Contact[]) => {
    try {
      await AsyncStorage.setItem('emergencyContacts', JSON.stringify(contacts));
      setEmergencyContacts(contacts);
    } catch (err) {
      console.error('Failed to save emergency contacts:', err);
    }
  };

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
      
      <ThemedView style={styles.nameContainer}>
        <ThemedText type="subtitle" style={styles.statusTitle}>Your Information</ThemedText>
        <TextInput
          style={styles.nameInput}
          value={fullName}
          onChangeText={(text) => {
            setFullName(text);
            handleSaveName(text);
          }}
          placeholder="Enter your full name"
          placeholderTextColor="#666"
        />
      </ThemedView>

      <ThemedView style={styles.contactsContainer}>
        <ThemedText type="subtitle" style={styles.statusTitle}>Emergency Contacts</ThemedText>
        
        {emergencyContacts.map((contact, index) => (
          <ThemedView key={index} style={styles.contactItem}>
            <ThemedText style={styles.contactName}>
              {contact.name}
            </ThemedText>
            <ThemedText style={styles.contactPhone}>
              {contact.phoneNumbers?.[0]?.number}
            </ThemedText>
            <TouchableOpacity
              onPress={() => {
                const newContacts = emergencyContacts.filter((_, i) => i !== index);
                saveEmergencyContacts(newContacts);
              }}
              style={styles.removeContactButton}>
              <ThemedText style={styles.removeContactText}>Remove</ThemedText>
            </TouchableOpacity>
          </ThemedView>
        ))}
        
        <TouchableOpacity
          style={styles.addContactButton}
          onPress={handlePickContact}>
          <ThemedText style={styles.addContactText}>
            Add Emergency Contact
          </ThemedText>
        </TouchableOpacity>
      </ThemedView>

      <ThemedView style={styles.emergencyContainer}>
        <ThemedText type="subtitle" style={styles.statusTitle}>Status</ThemedText>
        <ThemedText style={styles.statusText}>
          Emergency Mode: {emergencyMode ? '🚨 ACTIVE' : 'Inactive'}
        </ThemedText>
        {location && (
          <ThemedText style={styles.statusText}>
            Location: {location.coords.latitude.toFixed(4)}, {location.coords.longitude.toFixed(4)}
          </ThemedText>
        )}
        
        {emergencyMode ? (
          // Show I'm OK button during emergency
          <TouchableOpacity 
            style={styles.imOkButton}
            onPress={() => setShowPasswordModal(true)}>
            <ThemedText style={styles.imOkButtonText}>I'm OK</ThemedText>
          </TouchableOpacity>
        ) : (
          // Show password setup button when not in emergency
          <TouchableOpacity
            style={styles.passwordSetupButton}
            onPress={() => setShowPasswordModal(true)}>
            <ThemedText style={styles.passwordSetupButtonText}>
              Change Emergency Password
            </ThemedText>
          </TouchableOpacity>
        )}

        {/* Password Modal */}
        <Modal
          visible={showPasswordModal}
          transparent
          animationType="slide">
          <ThemedView style={styles.modalContainer}>
            <ThemedView style={styles.modalContent}>
              <ThemedText type="subtitle">
                {emergencyMode ? 'Enter Password to Confirm' : 'Change Emergency Password'}
              </ThemedText>
              
              {!emergencyMode && (
                <ThemedText style={styles.passwordHint}>
                  Current password: {DEFAULT_PASSWORD}
                </ThemedText>
              )}
              
              <TextInput
                style={styles.passwordInput}
                value={password}
                onChangeText={setPassword}
                placeholder={emergencyMode ? "Enter password" : "Enter new password"}
                secureTextEntry
              />
              
              <TouchableOpacity
                style={styles.passwordButton}
                onPress={emergencyMode ? () => handleImOk(password) : handleSetPassword}>
                <ThemedText style={styles.buttonText}>
                  {emergencyMode ? 'Confirm' : 'Update Password'}
                </ThemedText>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => {
                  setShowPasswordModal(false);
                  setPassword('');
                }}>
                <ThemedText>Cancel</ThemedText>
              </TouchableOpacity>
            </ThemedView>
          </ThemedView>
        </Modal>
      </ThemedView>

      {/* <ThemedView style={styles.titleContainer}>
        <ThemedText type="title">Explore</ThemedText>
      </ThemedView>
      <ThemedText>IS SHAKING: {isShaking ? 'Yes! 📱' : 'No'}</ThemedText> */}
      
      {/* <ThemedText>Accelerometer: (in gs where 1g = 9.81 m/s^2)</ThemedText>
      <ThemedText>x: {x}</ThemedText>
      <ThemedText>y: {y}</ThemedText>
      <ThemedText>z: {z}</ThemedText>
      <ThemedText>Shaking: {isShaking ? 'Yes! 📱' : 'No'}</ThemedText> */}
      {/* <ThemedView>
        <TouchableOpacity onPress={subscription ? _unsubscribe : _subscribe} style={styles.button}>
          <ThemedText>{subscription ? 'On' : 'Off'}</ThemedText>
        </TouchableOpacity>
        <TouchableOpacity onPress={_slow} style={[styles.button, styles.middleButton]}>
          <ThemedText>Slow</ThemedText>
        </TouchableOpacity>
        <TouchableOpacity onPress={_fast} style={styles.button}>
          <ThemedText>Fast</ThemedText>
        </TouchableOpacity>
      </ThemedView> */}

      {/* Contacts Modal */}
      <Modal
        visible={showContactsModal}
        transparent
        animationType="slide">
        <ThemedView style={styles.modalContainer}>
          <ThemedView style={styles.modalContent}>
            <ThemedText type="subtitle">Select Emergency Contacts</ThemedText>
            <ScrollView style={styles.contactsList}>
              {contactsList?.map((contact, index) => (
                <TouchableOpacity
                  key={index}
                  style={styles.contactSelectItem}
                  onPress={() => {
                    if (emergencyContacts.length < 3) {
                      const newContacts = [...emergencyContacts, contact];
                      saveEmergencyContacts(newContacts);
                      setShowContactsModal(false);
                    } else {
                      Alert.alert('Limit Reached', 'You can only add up to 3 emergency contacts.');
                    }
                  }}>
                  <ThemedText>{contact.name}</ThemedText>
                  <ThemedText>{contact.phoneNumbers?.[0]?.number}</ThemedText>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setShowContactsModal(false)}>
              <ThemedText>Cancel</ThemedText>
            </TouchableOpacity>
          </ThemedView>
        </ThemedView>
      </Modal>
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
  imOkButton: {
    backgroundColor: '#4CAF50',
    padding: 15,
    borderRadius: 8,
    marginTop: 10,
  },
  imOkButtonText: {
    color: 'white',
    textAlign: 'center',
    fontWeight: 'bold',
    fontSize: 16,
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContent: {
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 8,
    width: '80%',
    alignItems: 'center',
  },
  passwordInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 4,
    padding: 10,
    width: '100%',
    marginVertical: 10,
  },
  passwordButton: {
    backgroundColor: '#2196F3',
    padding: 10,
    borderRadius: 4,
    marginTop: 10,
    width: '100%',
    alignItems: 'center',
  },
  cancelButton: {
    padding: 10,
    marginTop: 10,
    width: '100%',
    alignItems: 'center',
  },
  passwordSetupButton: {
    backgroundColor: '#2196F3',
    padding: 15,
    borderRadius: 8,
    marginTop: 10,
  },
  passwordSetupButtonText: {
    color: 'white',
    textAlign: 'center',
    fontWeight: 'bold',
    fontSize: 16,
  },
  passwordHint: {
    color: '#666',
    marginBottom: 10,
    fontSize: 14,
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  statusTitle: {
    color: '#000000',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  statusText: {
    color: '#000000',
    fontSize: 16,
    marginBottom: 4,
  },
  nameContainer: {
    padding: 15,
    backgroundColor: '#fff',
    borderRadius: 8,
    marginBottom: 10,
  },
  nameInput: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 4,
    padding: 10,
    fontSize: 16,
    color: '#000000',
    marginTop: 8,
  },
  contactsContainer: {
    padding: 15,
    backgroundColor: '#fff',
    borderRadius: 8,
    marginVertical: 10,
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  contactName: {
    flex: 1,
    fontSize: 16,
    color: '#000000',
  },
  contactPhone: {
    fontSize: 14,
    color: '#666',
    marginRight: 10,
  },
  removeContactButton: {
    backgroundColor: '#ff5252',
    padding: 8,
    borderRadius: 4,
  },
  removeContactText: {
    color: 'white',
    fontSize: 12,
  },
  addContactButton: {
    backgroundColor: '#2196F3',
    padding: 15,
    borderRadius: 8,
    marginTop: 10,
  },
  addContactText: {
    color: 'white',
    textAlign: 'center',
    fontWeight: 'bold',
    fontSize: 16,
  },
  contactsList: {
    maxHeight: 300,
    width: '100%',
  },
  contactSelectItem: {
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
});
