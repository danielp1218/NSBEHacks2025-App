// POTENTIALLY TAKE A PICTURE OF THE USER'S FACE AND USE IT TO DETERMINE THE SITUATION

import { Audio } from 'expo-av';

const OPENAI_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
const OPENAI_API_URL = 'https://api.openai.com/v1';
const BASE_URL = 'https://nsbe-hacks-2025-dashboard.vercel.app/api';
const SET_ANALYSIS_ENDPOINT = `${BASE_URL}/set-analysis`;

interface AudioAnalysis {
  transcription: string;
  sentiment: 'distress' | 'neutral' | 'unclear';
  threatLevel: 'high' | 'medium' | 'low';
  situationSummary: string;
  actionRecommendations: string[];
  detectedSounds: string[];
}

export async function analyzeAudioRecording(audioUri: string, incidentId?: string): Promise<AudioAnalysis> {
  try {
    // 1. First get the transcription using Whisper
    const transcription = await getAudioTranscription(audioUri);
    
    // 2. Then analyze the transcription and context using GPT
    const analysis = await analyzeTranscription(transcription);
    
    // TODO FIGURE OUT HOW TO NOT SEND THIS SO OFTEN
    // 3. If incidentId is provided, send analysis to backend
    if (incidentId) {
      try {
        await fetch(SET_ANALYSIS_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            incidentId,
            sentiment: analysis.sentiment,
            threatLevel: analysis.threatLevel,
            situationSummary: analysis.situationSummary,
            actionRecommendations: analysis.actionRecommendations,
            detectedSounds: analysis.detectedSounds
          }),
        });
      } catch (error) {
        console.error('Error sending analysis to backend:', error);
        // Continue execution even if backend update fails
      }
    }
    
    return {
      transcription: transcription,
      ...analysis
    };
  } catch (error) {
    console.error('Error analyzing audio:', error);
    throw error;
  }
}

async function getAudioTranscription(audioUri: string): Promise<string> {
  const formData = new FormData();
  formData.append('file', {
    uri: audioUri,
    type: 'audio/m4a',
    name: 'recording.m4a'
  } as any);
  formData.append('model', 'whisper-1');
  formData.append('prompt', `
    Transcribe all speech and describe any notable sounds using brackets.
    Examples:
    - [glass shattering]
    - [loud thud]
    - [footsteps running]
    - [muffled screaming]
    - [door slams]
    - [struggle sounds, rustling]
    Include these sound descriptions in the transcription exactly where they occur.
  `);

  const response = await fetch(`${OPENAI_API_URL}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: formData
  });

  const data = await response.json();
  return data.text;
}

async function analyzeTranscription(transcription: string): Promise<Omit<AudioAnalysis, 'transcription'>> {
  const prompt = `
    Analyze the following audio transcription from a potential emergency situation:
    "${transcription}"
    
    Provide a structured analysis including:
    1. Overall sentiment (distress/neutral/unclear)
    2. Threat level assessment (high/medium/low)
    3. Brief situation summary
    4. Key action recommendations for first responders
    5. Any notable background sounds mentioned
    
    Format as JSON with exactly these keys:
    {
      "sentiment",
      "threatLevel": "high" | "medium" | "low",
      "situationSummary": "string describing the situation",
      "actionRecommendations": ["string array of actions"],
      "detectedSounds": ["string array of sounds"]
    }
  `;

  const response = await fetch(`${OPENAI_API_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4',
      messages: [{
        role: 'user',
        content: prompt
      }],
      temperature: 0.3,
    })
  });

  console.log("ABC" + response.status)
  const data = await response.json();
  const analysis = JSON.parse(data.choices[0].message.content);
  console.log(analysis)

  return {
    sentiment: analysis.sentiment,
    threatLevel: analysis.threatLevel,
    situationSummary: analysis.situationSummary,
    actionRecommendations: analysis.actionRecommendations,
    detectedSounds: analysis.detectedSounds
  };
}

// Helper function to detect specific emergency sounds
export async function detectEmergencySounds(audioUri: string): Promise<string[]> {
  const transcription = await getAudioTranscription(audioUri);
  
  const prompt = `
    From this audio transcription, identify any emergency-related sounds mentioned:
    "${transcription}"
    
    Focus on sounds like:
    - Breaking glass
    - Gunshots
    - Screaming
    - Physical struggle sounds
    - Vehicle sounds
    - Door slamming
    
    Return only an array of detected sounds.
  `;

  const response = await fetch(`${OPENAI_API_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4',
      messages: [{
        role: 'user',
        content: prompt
      }],
      temperature: 0.3,
    })
  });

  const data = await response.json();
  return JSON.parse(data.choices[0].message.content);
}

// Add a new function specifically for background analysis
export async function analyzeAudioInBackground(audioUri: string, incidentId: string): Promise<void> {
  try {
    const analysis = await analyzeAudioRecording(audioUri);
    
    // Send analysis to backend
    await fetch(SET_ANALYSIS_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        incidentId,
        sentiment: analysis.sentiment,
        threatLevel: analysis.threatLevel,
        situationSummary: analysis.situationSummary,
        actionRecommendations: analysis.actionRecommendations,
        detectedSounds: analysis.detectedSounds
      }),
    });
  } catch (error) {
    console.error('Error in background audio analysis:', error);
    // Don't throw error in background process
  }
}
