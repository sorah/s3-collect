import React from "react";
import { Flex, Box } from 'reflexbox';
import * as Blueprint from '@blueprintjs/core';

import {UploadForm} from "./UploadForm";
import {UploadProgress} from "./UploadProgress";

import {UploadRequest} from "./Uploader";

export const App: React.FC<{}> = (props: {}) => {
  const search = new URLSearchParams(location.search);
  const token = search.get("token");

  const [request, setRequest] = React.useState<UploadRequest | null>(null);
  const onSubmit = (data: UploadRequest) => {
    setRequest(data);
  };

  const renderContent = () => {
    if (!token) {
      return <p>Error: token is required</p>;
    } else if (request !== null) {
      return <UploadProgress request={request} />;
    } else {
      return <UploadForm token={token} onSubmit={onSubmit} />;
    }
  }

  return <>
     <Flex textAlign="center" alignContent="center">
       <Flex width={900} pt={3}  marginX="auto">
         <Box width={'100%'} textAlign="left">
           <Blueprint.Card>
             {renderContent()}
           </Blueprint.Card>
         </Box>
       </Flex>
    </Flex>
  </>;
};
