import React, { useState, useEffect, useRef } from 'react';
import { View, TouchableOpacity, Text, Platform, PermissionsAndroid, StyleSheet } from 'react-native';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import { check, PERMISSIONS, request, RESULTS } from 'react-native-permissions';

const audioRecorderPlayer = new AudioRecorderPlayer();
const SILENCE_THRESHOLD = -10; // Adjust as needed
const SILENCE_DURATION = 2000; // 2 seconds

const Recorder = () => {
    const [recording, setRecording] = useState(false);
    const [recordedFilePath, setRecordedFilePath] = useState('');
    const silenceTimeout = useRef(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [audioDuration, setAudioDuration] = useState(0);
    const [currentPosition, setCurrentPosition] = useState(0);

    useEffect(() => {
        requestMicrophonePermission();
    }, []);

    const requestMicrophonePermission = async () => {
        if (Platform.OS === 'android') {
            const result = await PermissionsAndroid.request(
                PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
                {
                    title: 'Mic Permission',
                    message: 'This app requires Mic permission for recordings.',
                    buttonNeutral: 'Ask Me Later',
                    buttonNegative: 'Cancel',
                    buttonPositive: 'OK',
                },
            );
            if (result === PermissionsAndroid.RESULTS.GRANTED) {
                console.log('Mic permission granted');
            } else {
                console.log('Mic permission denied');
            }
        } else {
            const microphonePermission = await check(PERMISSIONS.IOS.MICROPHONE);
            if (microphonePermission === RESULTS.GRANTED) {
                console.log('Mic permission granted');
            } else {
                const permissionResult = await request(PERMISSIONS.IOS.MICROPHONE);
                if (permissionResult === RESULTS.GRANTED) {
                    console.log('Mic permission granted');
                } else {
                    console.log('Mic permission denied');
                }
            }
        }
    };

    const onStartRecord = async () => {
        console.log('Recording...');
        const result = await audioRecorderPlayer.startRecorder();
        audioRecorderPlayer.addRecordBackListener((e) => {
            console.log('Recording...', e);
            console.log('e.currentMetering...', e.currentMetering);
            if (e.currentMetering < SILENCE_THRESHOLD) {
                if (!silenceTimeout.current) {
                    silenceTimeout.current = setTimeout(() => {
                        onStopRecord();
                    }, SILENCE_DURATION);
                }
            } else {
                clearTimeout(silenceTimeout.current);
                silenceTimeout.current = null;
            }
        });
        setRecording(true);
        console.log(result);
    };

    const onStopRecord = async () => {
        const result = await audioRecorderPlayer.stopRecorder();
        audioRecorderPlayer.removeRecordBackListener();
        clearTimeout(silenceTimeout.current);
        silenceTimeout.current = null;
        setRecordedFilePath(result);
        setRecording(false);
        console.log(result);
        // uploadAudio(result);
    };

    const uploadAudio = async (filePath) => {
        const formData = new FormData();
        formData.append('audio', {
            uri: Platform.OS === 'android' ? `file://${filePath}` : filePath,
            type: 'audio/wav',
            name: 'audio.wav',
        });

        try {
            const response = await fetch('YOUR_API_ENDPOINT', {
                method: 'POST',
                headers: {
                    'Content-Type': 'multipart/form-data',
                },
                body: formData,
            });
            const data = await response.json();
            console.log('Upload success', data);
        } catch (error) {
            console.error('Upload failed', error);
        }
    };

    const onStartPlay = async () => {
        console.log('Playing...');
        const msg = await audioRecorderPlayer.startPlayer(recordedFilePath);
        audioRecorderPlayer.addPlayBackListener((e) => {
            setCurrentPosition(e.currentPosition);
            setAudioDuration(e.duration);
            if (e.currentPosition === e.duration) {
                console.log('Finished playing');
                onStopPlay();
            }
        });
        setIsPlaying(true);
        console.log(msg);
    };

    const onStopPlay = async () => {
        console.log('Stopped playing...');
        const msg = await audioRecorderPlayer.stopPlayer();
        audioRecorderPlayer.removePlayBackListener();
        setIsPlaying(false);
        setCurrentPosition(0);
        console.log(msg);
    };

    const formatTime = (milliseconds) => {
        const minutes = Math.floor(milliseconds / 60000);
        const seconds = Math.floor((milliseconds % 60000) / 1000);
        const formattedMinutes = String(minutes).padStart(2, '0');
        const formattedSeconds = String(seconds).padStart(2, '0');
        return `${formattedMinutes}:${formattedSeconds}`;
    };

    return (
        <View style={styles.container}>
            <View style={styles.recordContainer}>
                <TouchableOpacity
                    style={[styles.button, recording && styles.recordingButton]}
                    onPress={recording ? onStopRecord : onStartRecord}
                    activeOpacity={0.8}
                >
                    <Text style={styles.buttonText}>
                        {recording ? 'Stop Recording' : 'Start Recording'}
                    </Text>
                </TouchableOpacity>
            </View>
            <View style={styles.playerContainer}>
                <Text style={styles.playerStatus}>
                    {isPlaying ? 'Playing' : ''}
                </Text>
                <View style={styles.progressBar}>
                    <View
                        style={{
                            width: `${(currentPosition / audioDuration) * 100}%`,
                            height: '100%',
                            backgroundColor: '#28a745',
                        }}
                    />
                </View>
                <Text style={styles.timer}>
                    {formatTime(currentPosition)} / {formatTime(audioDuration)}
                </Text>
                <TouchableOpacity
                    style={[styles.button, recordedFilePath && styles.playButton]}
                    onPress={recordedFilePath ? (isPlaying ? onStopPlay : onStartPlay) : null}
                    activeOpacity={0.8}
                    disabled={!recordedFilePath}
                >
                    <Text style={styles.buttonText}>
                        {isPlaying ? 'Pause' : 'Play'}
                    </Text>
                </TouchableOpacity>
            </View>
        </View>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#f0f0f0',
        padding: 20,
    },
    recordContainer: {
        marginBottom: 20,
    },
    playerContainer: {
        alignItems: 'center',
        marginBottom: 20,
    },
    progressBar: {
        width: '100%',
        height: 10,
        backgroundColor: '#ddd',
        marginTop: 10,
    },
    playerStatus: {
        fontSize: 20,
        marginBottom: 10,
        color: 'black',
    },
    timer: {
        fontSize: 16,
        marginBottom: 10,
        color: 'black',
    },
    button: {
        backgroundColor: '#007bff',
        paddingHorizontal: 20,
        paddingVertical: 10,
        borderRadius: 8,
        elevation: 2,
        marginVertical: 5,
    },
    recordingButton: {
        backgroundColor: '#dc3545', // Red color when recording
    },
    playButton: {
        backgroundColor: '#28a745', // Green color when playable
    },
    buttonText: {
        color: '#fff',
        fontSize: 18,
        textAlign: 'center',
    },
    filePath: {
        marginTop: 20,
        textAlign: 'center',
        fontSize: 16,
        color: 'black',
    },
});

export default Recorder;
