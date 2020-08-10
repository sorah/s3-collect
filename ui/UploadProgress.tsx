import React from "react";
import { Flex, Box } from 'reflexbox';
import * as Blueprint from '@blueprintjs/core';

import {Uploader, UploadRequest} from "./Uploader";

enum UploadState {
  PENDING = "pending",
  UPLOADING = "uploading",
  FINALIZING = "finalizing",
  SUCCEEDED = "succeeded",
  FAILED = "failed",
}

type UploadProgress = {
  name: string,
  file: File,
  started: boolean,
  completed: boolean,
  progress: number | null,
}

type Props = {
  request: UploadRequest,
}

export const UploadProgress: React.FC<Props> = (props: Props) => {
  const [filesMap, setFilesMap] = React.useState<Map<string, UploadProgress>>(
    new Map(props.request.files.map((v) => [v.name, {name: v.name, file: v, started: false, completed: false, progress: null}])));
  const [error, setError] = React.useState<Error | null>(null);
  const [uploadState, setUploadState] = React.useState<UploadState>(UploadState.PENDING);

  React.useEffect(() => {
    const handler = (e: BeforeUnloadEvent) =>{
      if (uploadState !== UploadState.UPLOADING) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => { window.removeEventListener('beforeunload', handler) };
  }, [uploadState]);

  React.useEffect(() => {
    const onStarted = () => { setUploadState(UploadState.UPLOADING) };
    const onFinalizeStarted = () => { setUploadState(UploadState.FINALIZING) };
    const onFinished = () => { setUploadState(UploadState.SUCCEEDED) };
    const onProgress = (name: string, completed: boolean, progress: number | null) => {
      const newFilesMap = new Map(filesMap);
      const prog = filesMap.get(name)!;
      prog.started = true;
      prog.completed = completed;
      prog.progress = progress;
      newFilesMap.set(name, prog);
      setFilesMap(newFilesMap);
    };
    const uploader = new Uploader({
      token: props.request.token,
      name: props.request.name,
      files: props.request.files,
      onStarted,
      onFinished,
      onFinalizeStarted,
      onProgress,
    });
    (async () => {
      try {
        await uploader.perform();
      } catch (e) {
        setUploadState(UploadState.FAILED);
        setError(e);
      }
    })();
  }, []);

  const renderProgressBar = () => {
    const totalProgress = Array.from(filesMap.values()).reduce((r,i) => r + (i.progress||0), 0) / filesMap.size;
    switch (uploadState) {
      case UploadState.PENDING:
        return <Blueprint.ProgressBar intent="none" value={undefined} animate={true} />
        break;
      case UploadState.UPLOADING:
        return <Blueprint.ProgressBar intent="primary" value={totalProgress} />
        break;
      case UploadState.FINALIZING:
        return <Blueprint.ProgressBar intent="warning" value={totalProgress} animate={true} />
        break;
      case UploadState.SUCCEEDED:
        return <Blueprint.ProgressBar intent="success" value={1} animate={false} />
        break;
      case UploadState.FAILED:
        return <Blueprint.ProgressBar intent="danger" value={totalProgress} animate={false} />
        break;
    }
    throw new Error("[BUG] shouldn't reach here");
  };

  const renderProgressBarFile = (prog: UploadProgress) => {
    if (!prog.started) {
      return <Blueprint.ProgressBar intent="none" value={undefined} animate={true} />;
    } else if (prog.completed) {
      return <Blueprint.ProgressBar intent="success" value={1} animate={false} />;
    } else if (prog.progress !== null) {
      return <Blueprint.ProgressBar intent="primary" value={prog.progress} animate={true} />;
    } else if (prog.progress === null) {
      return <Blueprint.ProgressBar intent="primary" value={undefined} animate={true} />;
    }
    throw new Error("[BUG] should unreach");
  };
  const renderProgressFiles = () => {
    return <section>
      {Array.from(filesMap.values()).map((prog) => <Flex key={prog.name} justifyContent="space-between" alignItems="center">
        <Flex alignItems="center">
          <Box mr="2em">{prog.name}</Box>
          <Box>{prog.file.size} bytes</Box>
        </Flex>
        <Box maxWidth="250px" width="25%">
          {renderProgressBarFile(prog)}
        </Box>
      </Flex>)}
    </section>;
  };

  return <>
    <Blueprint.H1>Upload</Blueprint.H1>
    <Box mt="2em">
      {error ? <Blueprint.Callout intent="danger" title="Error">{error.toString()}</Blueprint.Callout> : null}
      {uploadState === UploadState.PENDING ? <Blueprint.Callout intent="none" title="Starting..."><p>Preparing to upload the files</p></Blueprint.Callout> : null}
      {uploadState === UploadState.UPLOADING ? <Blueprint.Callout intent="primary" title="Uploading..."><p>Files are being uploaded</p></Blueprint.Callout> : null}
      {uploadState === UploadState.FINALIZING ? <Blueprint.Callout intent="warning" title="Finalizing"><p>Files are uploaded, notifying complete...</p></Blueprint.Callout> : null}
      {uploadState === UploadState.SUCCEEDED ? <Blueprint.Callout intent="success" title="Complete"><p>Files successfully uploaded!</p></Blueprint.Callout> : null}
    </Box>
    <Box mt="2em">
      {renderProgressBar()}
    </Box>
    <Box mt="2em">
      <Blueprint.H3>Files</Blueprint.H3>
      {renderProgressFiles()}
    </Box>
  </>;
};
