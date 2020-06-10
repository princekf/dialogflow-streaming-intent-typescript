import * as  util from 'util';
import { Transform, pipeline, PassThrough } from 'stream';
const Speaker = require( 'speaker');
import { v4 as uuidv4 } from 'uuid';
import * as dialogflow from '@google-cloud/dialogflow';
import * as recorder from 'node-record-lpcm16';
/*
 "dependencies": {
    "@google-cloud/dialogflow": "^2.0.0",
    "@google-cloud/speech": "^4.0.0",
    "@types/uuid": "^8.0.0",
    "audio-play": "^2.2.1",
    "node-record-lpcm16": "^1.0.1",
    "pb-util": "^0.1.3",
    "speaker": "^0.5.1"
  },
  "dev
*/
class IRDialogFlow {
  private sessionClient: dialogflow.v2.SessionsClient;
  private projectId: string;
  private sessionId: string;
  private sessionPath: string;
  private recording: any;

  constructor(projectId){
    this.projectId = projectId;
    this.sessionId = uuidv4();
    this.sessionClient = new dialogflow.v2.SessionsClient({keyFilename : './dialogflow-test-101-4e5b1ab83caa.json'});
    this.sessionPath = this.sessionClient.projectAgentSessionPath(
      projectId,
      this.sessionId,
    );
  }

  private createtreamingDetectIntent = async () => {
    let isLastIntent = false;
    let fulfillmentText = null;
    return new Promise(async resolve => {
      const detectStream = this.sessionClient
      .streamingDetectIntent()
      .on('error', console.error)
      .on('data', async data => {
        if (data.recognitionResult) {
          console.log( `Intermediate transcript: ${data.recognitionResult.transcript}` );
          if (data.recognitionResult.isFinal) {
            console.log("Result Is Final");
            this.recording.stop();
          }
        } else {
          console.log('Detected intent:');
          if(data.queryResult && data.queryResult.fulfillmentText){
            fulfillmentText = data.queryResult.fulfillmentText;
          }
          isLastIntent = isLastIntent || data.queryResult && data.queryResult.diagnosticInfo && data.queryResult.diagnosticInfo.fields
           && data.queryResult.diagnosticInfo.fields.end_conversation && data.queryResult.diagnosticInfo.fields.end_conversation.boolValue;
          if (data.outputAudio && data.outputAudio.length) {
            return resolve({
              outputAudio: data.outputAudio, 
              isLastIntent,
              fulfillmentText
            });
          }
        }
      });
      // 1. start mic
      this.recording = recorder.record({
        sampleRateHertz: 16000,                
        threshold: 0,                
        verbose: false,                
        recordProgram: 'sox', // Try also "arecord" or "sox"
        silence: '1.0',
        device: 'plughw:1,0',
        endOnSilence: true,
      });
      const recordingStream = this.recording.stream().on('error', console.error);

      // 2. connect to dialog flow.
      const pump = util.promisify(pipeline);
      console.log('Session client initilized...');
      
      // The encoding of the audio file, e.g. 'AUDIO_ENCODING_LINEAR_16'
      const audioEncoding = 'OUTPUT_AUDIO_ENCODING_LINEAR_16';
      // The sample rate of the audio file in hertz, e.g. 16000
      const sampleRateHertz = 16000;
      // The BCP-47 language code to use, e.g. 'en-US'
      const languageCode = 'en-US';
      const synthesizeSpeechConfig = {
        speakingRate: 1,
        volumeGainDb: 2,
        voice: {
          name: 'en-US-Wavenet-E',
        }
      }
      const initialStreamRequest = {
        session: this.sessionPath,
        queryInput: {
          audioConfig: {
            audioEncoding : 'LINEAR16',
            sampleRateHertz,
            languageCode,
          },
          singleUtterance: true,
        },
        outputAudioConfig: {
          audioEncoding,
          sampleRateHertz,
          synthesizeSpeechConfig,
        },
      };
      detectStream.write(initialStreamRequest);
      await pump(
        recordingStream,
        // Format the audio stream into the request format.
        new Transform({
          objectMode: true,
          transform: (obj, _, next) => {
            next(null, { inputAudio: obj });
          },
        }),
        detectStream
      );
    });
  };

  private handleDetectedStreamResult = (intentDetails) => {
    return new Promise(resolve => {
      const speaker = new Speaker({
        channels: 1,
        bitDepth: 16,
        sampleRate: 16000,
      });
      speaker.on("close", () => {
        resolve();
      });
      // Setup the audio stream, feed the audio buffer in
      const audioStream = new PassThrough();
      audioStream.pipe(speaker);
      audioStream.end(intentDetails.outputAudio);
    });
  };

  public start = async () => {
    await this.sessionClient.initialize();
    while(true){
      const intentDetails:any = await this.createtreamingDetectIntent();
      await this.handleDetectedStreamResult(intentDetails);
      if(intentDetails.isLastIntent){
        console.log('finished.');
        break;
      }
    }
    
    
  };
}

(async () => {
  const projectId = 'dialogflow-test-101'; //'ID of GCP project associated with your Dialogflow agent';
  const irDF = new IRDialogFlow(projectId)
  await irDF.start();
})();