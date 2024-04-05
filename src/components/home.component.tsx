import { Component, ChangeEvent } from "react";
import { Formik, Field, Form, ErrorMessage } from "formik";
import * as Yup from "yup";
import { Navigate } from "react-router-dom";
import axios from "axios";
import {
  S3Client,
  UploadPartCommand,
  UploadPartCommandInput
} from '@aws-sdk/client-s3'

const client = new S3Client({ 
  region: 'us-east-2',
  credentials: {
    accessKeyId: process.env.ACCESS_KEY || 'KEY',
    secretAccessKey: process.env.SECRET_KEY || 'SECRET',
  }
})

const url:string = process.env.BASE_URL || 'https://xxxxxx.execute-api.us-east-2.amazonaws.com';

type Props = {};

type State = {
  redirect: string | null,
  parallelcalls: number,
  accelerate:boolean,
  maxsize: number,
  loading: boolean,
  message: string,
  file_size: number,
  file_name: string,
  file_type: string,
  file_num_parts: number,
  num_parts: number,
  resp_uploadid:any,
  resp_parts:any,
  resp_status:string,
  resp_message:string,
  resp_body:string,
  time_to_upload_miliseconds: number
};

export default class Home extends Component<Props, State> {
  
  constructor(props: Props) {
    super(props);

    this.state = {
      redirect: null,
      parallelcalls: 2,
      accelerate:false,
      maxsize: 5,
      loading: false,
      message: "",
      file_size: 0,
      file_name: "",
      file_type: "",
      file_num_parts: 0,
      num_parts: 0,
      resp_uploadid: undefined,
      resp_parts: undefined,
      resp_status: "0",
      resp_message:"",
      resp_body:"",
      time_to_upload_miliseconds:0
    };
  }

  validationSchema() {
    return Yup.object().shape({
    
    });
  }

  handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      try {
        // INFO about the uploaded file
        const slice_size = Math.max((1024 * 1024 * this.state.maxsize ), (1024 * 1024 * 5));
        let file_size = e.target.files[0].size;
        const num_parts = Math.ceil(file_size / slice_size);
        const bucketname = 'presignurl';

        this.setState({ 
          file_name: e.target.files[0].name,
          file_size: e.target.files[0].size,
          file_type: e.target.files[0].type,
          num_parts: num_parts,
          resp_message: "Requesting uploadid"
        });

        // Acceleration option
        client.config.useAccelerateEndpoint = this.state.accelerate;

        await new Promise(f => setTimeout(f, 1000));

        // Get uploadID
        const result:any = await axios.get(`${url}/Prod/getuploadid/?bucketName=${bucketname}&fileName=${e.target.files[0].name}`);
        
        this.setState({ 
          resp_uploadid: JSON.stringify(result.data, null, 2),
          resp_status: "25",
          resp_message: "Success generated"
        });

        await new Promise(f => setTimeout(f, 1000));

        this.setState({ 
          resp_message: "Requesting urls"
        });

        // Get URLs
        const parts:any = await axios.get(`${url}/Prod/geturl/?partNumber=${num_parts.toString()}&bucketName=${bucketname}&fileKey=${result.data.fileKey}&fileId=${result.data.fileId}`);

        this.setState({ 
          resp_parts: JSON.stringify(parts.data, null, 2),
          resp_status: "50",
          resp_message: "URLs Success generated"
        });

        await new Promise(f => setTimeout(f, 1000));

        this.setState({ 
          resp_message: "Uploading the file",
          resp_status: "75"
        });

        const startTime:number = performance.now()

        // Upload the file in chunck
        let file_sent:number = 0;
        
        let part_results = [];

        for(const part of parts.data.parts){
          if((file_size - slice_size) >= 0){
            const chunk = e.target.files[0].slice(file_sent,file_sent + slice_size);
            file_sent = file_sent + slice_size;
            file_size = file_size - slice_size;
            //send slice
            part_results.push(await this.sendChunk(chunk,part,bucketname,result.data.fileKey,result.data.fileId));
            if(file_size === file_sent){
              // Send completed command
              this.sendCompleted(part_results,result.data.fileId,result.data.fileKey,bucketname);
            }
          } else {
            //last piece of file
            const chunk = e.target.files[0].slice(file_sent,file_sent + file_size);
            //send slice
            part_results.push(await this.sendChunk(chunk,part,bucketname,result.data.fileKey,result.data.fileId));
            // Send completed command
            this.sendCompleted(part_results,result.data.fileId,result.data.fileKey,bucketname);
          }
        }

        const endTime:number = performance.now()

        this.setState({ 
          resp_message: "File uploaded",
          time_to_upload_miliseconds: endTime - startTime
        });

        await new Promise(f => setTimeout(f, 1000));

        this.setState({ 
          resp_message: "Sending completed command"
        });

      }catch(e){
        let message = "Error in upload the file";
        if (typeof e === "string") {
          message = `${message} : ${e.toUpperCase()}`;
        } else if (e instanceof Error) {
          message = `${message} : ${e.message}`;
        }
        this.setState({ 
          resp_message: message
        });
      }
    }
  };

  sendChunk = async (chunk:any, part:any, bucket:string, fileKey:string, uploadId:string ) => {

    const uploadParams: UploadPartCommandInput = {
      Body: chunk,
      Bucket: bucket,
      Key: fileKey,
      UploadId: uploadId,
      PartNumber: part.PartNumber
    }

    const uploadPartResponse = await client.send(new UploadPartCommand(uploadParams));
    console.log(`Part #${part.PartNumber} uploaded. ETag: `, uploadPartResponse.ETag)

    return { PartNumber: part.PartNumber, ETag: uploadPartResponse.ETag }
  }

  sendCompleted = async (parts:any, fileId:string, fileKey:string, bucketName:string) => {
    try {
      // Get URLs
      const options = {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json;charset=UTF-8'
        },
        body: JSON.stringify({
          'bucketName': bucketName,
          'fileKey': fileKey,
          'parts' : parts,
          'fileId' : fileId
        })
      };
      const result = await fetch(`${url}/Prod/postcompleted`,options);

      this.setState({ 
        resp_status: "100",
        resp_message: "End of process sucessfuly",
        resp_body: `Finished with status: ${result.status}`
      });
    }catch(e){
      let message = "Error in send the completed command";
      if (typeof e === "string") {
        message = `${message} : ${e.toUpperCase()}`;
      } else if (e instanceof Error) {
        message = `${message} : ${e.message}`;
      }
      this.setState({ 
        resp_message: message
      });
    }
  }

  initialValues = {
  };

  render() {
    if (this.state.redirect) {
      return <Navigate to={this.state.redirect} />
    }
    
    return (
          <Formik
            initialValues={this.initialValues}
            validationSchema={this.validationSchema}
            onSubmit={(values, actions) => {
              console.log({ values, actions });
              alert(JSON.stringify(values, null, 2));
              actions.setSubmitting(false);
            }}
          >
            
            <Form>
              
              <div className="card">
              <h4>Settings</h4>
                <div className="form-group">
                  <label htmlFor="maxsize">size per call (MB) lower than 5MB is 5MB </label>
                  <Field name="maxsize" type="number" className="form-control" min="5" max="500" onChange={(e: ChangeEvent<HTMLInputElement>) => this.setState({maxsize:Number(e.target.value)})}/>
                  <ErrorMessage
                    name="maxsize"
                    component="div"
                    className="alert alert-danger"
                  />
                </div>
                

                <div className="form-group">
                  <label htmlFor="parallelcalls">Number of parallel calls</label>
                  <Field name="parallelcalls" type="number" className="form-control" onChange={(e: ChangeEvent<HTMLInputElement>) => this.setState({parallelcalls:Number(e.target.value)})} />
                  <ErrorMessage
                    name="parallelcalls"
                    component="div"
                    className="alert alert-danger"
                  />
                </div>

                
                <div className="form-check">
                  <Field name="accelerate" type="checkbox" className="form-check-input" onClick={(e: ChangeEvent<HTMLInputElement>) => this.setState({accelerate:e.target.checked})}/>
                  Transfer Acceleration
                  
                
                  <ErrorMessage
                    name="accelerate"
                    component="div"
                    className="alert alert-danger"
                  />
                </div>

                <div className="form-group mb-3" >
                  <label htmlFor="inputGroupFile01">Choose the file to automaticaly submit</label>
                  <input name="video" type="file" className="form-control" onChange={this.handleFileChange} />
                  <ErrorMessage
                    name="videofile"
                    component="div"
                    className="alert alert-danger"
                  />
                </div>
              </div>
              <div className="card">
                <div className="form-group">
                  <span><h4>File Details</h4> </span>
                  <span><b>Name: </b></span>
                  <span>{this.state.file_name}</span>
                  <br></br>
                  <span><b>Size: </b></span>
                  <span>{this.state.file_size}</span>
                  <br></br>
                  <span><b>Type: </b></span>
                  <span>{this.state.file_type}</span>
                  <br></br>
                  <span><b>Number of parts: </b></span>
                  <span>{this.state.num_parts}</span>
                </div>
              </div>
              <div className="progress" role="progressbar" aria-label="Basic example">
                <div className={`progress-bar w-${this.state.resp_status} progress-bar-striped`}>{this.state.resp_status}%</div>
              </div>
              <div className="card">
                <div className="form-group">
                  <span><b>Progress: </b></span>
                  <span>{this.state.resp_status}%</span>
                  <br></br>
                  <span><b>Progress status: </b></span>
                  <span>{this.state.resp_message}</span>
                  <br></br><br></br>
                  <span><b>UploadID: </b></span>
                  <br></br>
                  {this.state.resp_uploadid}
                  <br></br>
                  <span><b>Parts: </b></span>
                  <br></br>
                  {this.state.resp_parts}
                  <br></br>
                  <span><b>Time to upload: </b></span>
                  <br></br>
                  {this.state.time_to_upload_miliseconds.toFixed(2)} Miliseconds
                  <br></br>
                  {(this.state.time_to_upload_miliseconds/1000).toFixed(2)} Seconds
                  <br></br>
                  <span><b>Completed result: </b></span>
                  <br></br>
                  {this.state.resp_body}
                </div>
              </div>
            </Form>
          </Formik>
    );
  }
}
