import React from "react";
import { Flex, Box } from 'reflexbox';
import * as Blueprint from '@blueprintjs/core';

import {useForm} from 'react-hook-form';
import {useDropzone} from 'react-dropzone';

import {UploadRequest} from "./Uploader";

type Props = {
  token: string,
  onSubmit: (data: UploadRequest) => any,
};

type FormProps = {
  name: string,
};

const renderAcceptedFiles = (files: File[]) => {
  return <ul>
    {files.map((f,i) => <li key={i}>{f.name} ({f.size} bytes)</li>)}
  </ul>
}

export const UploadForm: React.FC<Props> = (props: Props) => {
  const {acceptedFiles, getRootProps, getInputProps} = useDropzone();
  const { register, handleSubmit } = useForm<FormProps>();
  const [ filesValidationElem, setFilesValidationElem ] = React.useState<JSX.Element | null>(null);

  const onSubmit = handleSubmit((data: FormProps) => {
    if (acceptedFiles.length == 0 ) {
      setFilesValidationElem(<Blueprint.Callout intent="danger" title="Cannot Upload"><p>Please select at least 1 file.</p></Blueprint.Callout>);
      return;
    }
    const req: UploadRequest = {
      token: props.token,
      name: data.name.replace(/ +/g, '-'),
      files: acceptedFiles,
    };
    props.onSubmit(req);
  });
  return <>
    <Blueprint.H1>Drop a file</Blueprint.H1>
    <form onSubmit={onSubmit}>
      <Blueprint.FormGroup label="Name" labelFor="UploadForm-name" helperText="Your real or screen name that we can identify you">
        <Blueprint.InputGroup id="UploadForm-name" name="name" placeholder="/^[a-zA-Z0-9.\-_ ]{1,20}$/" required={true} pattern={"^[a-zA-Z0-9.\\-_ ]{1,20}$"} maxLength={20} inputRef={register} autoFocus={true} />
      </Blueprint.FormGroup>
 
      <Blueprint.FormGroup>
        <Blueprint.Callout>
          <div {...getRootProps({className: 'dropzone'})}>
            <Flex width="100%" minHeight={"150px"} alignItems="center" alignContent="center" justifyContent="center">
              <Box>
                  <input {...getInputProps()} />
                  {acceptedFiles.length == 0 ?
                    <p>Drop files here or click to select files</p>
                  : <p>To choose again, drop files here or click to select files</p>
                  }
                  {renderAcceptedFiles(acceptedFiles)}
              </Box>
            </Flex>
          </div>
        </Blueprint.Callout>
      </Blueprint.FormGroup>

      <Blueprint.FormGroup>
        {filesValidationElem}
      </Blueprint.FormGroup>

      <Blueprint.FormGroup>
        <Blueprint.Button type="submit" intent="primary" text="Upload" />
      </Blueprint.FormGroup>
    </form>
  </>;
};
