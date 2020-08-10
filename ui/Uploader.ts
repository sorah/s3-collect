import AWS from 'aws-sdk/global';
import S3 from 'aws-sdk/clients/s3';

type SessionRequest = {
  name: string,
  token: string,
  continuation_handler: string | null,
};

type CompleteRequest = {
  name: string,
  token: string,
  continuation_handler: string | null,
};

export type SessionCredentials = {
  access_key_id: string,
  secret_access_key: string,
  session_token: string,
};

export type SessionData = {
  region: string,
  bucket: string,
  prefix: string,
  refresh_after: number,
  continuation_handler: string,
  use_accelerated_endpoint: boolean,
  credentials: SessionCredentials,
};

export type UploadRequest = {
  token: string,
  name: string,
  files: File[],
};

export type Params = {
  token: string,
  name: string,
  files: File[],
  onStarted: () => any,
  onFinalizeStarted: () => any,
  onFinished: () => any,
  onProgress: (name: string, completed: boolean, progress: number | null) => any,
}

type PendingRefreshResolver = {
  resolve: ((value: SessionData | PromiseLike<SessionData>) => void),
  reject: (e: Error) => any
}

export class Uploader {
  public props: Params;
  public done: boolean;

  private session?: SessionData | null;
  private s3?: S3 | null;
  private credentials?: AWS.Credentials;

  private pendingRefreshResolvers: PendingRefreshResolver[];

  constructor(props: Params) {
    this.props = props;
    this.done = false;
    this.pendingRefreshResolvers = [];
  }

  public async getSession(continuationHandler?: string) {
    if (!continuationHandler && this.session) return this.session;
    console.log(`[Uploader] getSession(continuationHandler=${continuationHandler})`);

    const sessionPayload: SessionRequest = {name: this.props.name, token: this.props.token, continuation_handler: null};
    if (continuationHandler) sessionPayload.continuation_handler = continuationHandler;

    const sessionResp = await fetch('/api-prd/sessions', {method: 'POST', credentials: 'include', body: JSON.stringify(sessionPayload)});
    if (sessionResp.ok) {
      const session: SessionData = await sessionResp.json();
      this.session = session;
      if (!this.credentials) this.credentials = this.generateAwsCredentialsFromSession(session);
      return this.session;
    } else {
      throw new Error(`Cannot obtain session: status=${sessionResp.status}, text=${await sessionResp.text()}`);
    }
  }

  generateAwsCredentialsFromSession(session: SessionData) {
    const credentials = new AWS.Credentials({
      accessKeyId: session.credentials.access_key_id,
      secretAccessKey: session.credentials.secret_access_key,
      sessionToken: session.credentials.session_token,
    });
    const expireTime = new Date();
    expireTime.setTime(expireTime.getTime() + (session.refresh_after * 1000));
    credentials.expireTime = expireTime;

    const self = this;
    credentials.refresh = async function (cb: (err: AWS.AWSError | undefined) => any) {
      console.log(`[Uploader] AWSCredentials#refresh; request`);
      try {
        const newSession = await self.refreshSession();
        console.log(`[Uploader] AWSCredentials#refresh; response`);
        if (newSession) {
          this.accessKeyId = newSession.credentials.access_key_id;
          this.secretAccessKey = newSession.credentials.secret_access_key;
          this.sessionToken = newSession.credentials.session_token;

          const expireTime = new Date();
          expireTime.setTime(expireTime.getTime() + (newSession.refresh_after * 1000));
          this.expireTime = expireTime;
          this.expired = false;

          console.log(`[Uploader] AWSCredentials#refresh; done`);
        } else {
          console.log(`[Uploader] AWSCredentials#refresh; NO SESSION`);
        }
        cb(undefined);
      } catch (e) {
        cb(e);
      }
    };
    return credentials;
  }

  public refreshSession() {
    if (this.pendingRefreshResolvers.length == 0) {
      console.log(`[Uploader] refreshSession(); request`);
      (async () => {
        try {
          if (this.done) throw new Error("[BUG] Refresh attemped after completion");
          if (!this.session?.continuation_handler) throw new Error("Session expired");
          const newSession = await this.getSession(this.session.continuation_handler);
          console.log(`[Uploader] refreshSession(); resolve`);
          this.pendingRefreshResolvers.forEach(({resolve,reject}) => resolve(newSession));
          this.pendingRefreshResolvers = [];
          return newSession;
        } catch (e) {
          this.pendingRefreshResolvers.forEach(({resolve,reject}) => reject(e));
          console.log(`[Uploader] refreshSession(); reject`);
          throw e;
        }
      })();
    }
    console.log(`[Uploader] refreshSession()`);
    const promise = new Promise<SessionData>((resolve,reject) => {
      this.pendingRefreshResolvers.push({resolve, reject});
    });
    return promise;
  }

  public async getS3() {
    if (this.s3) return this.s3;
    const session = await this.getSession();
    this.s3 = new S3({
      useDualstack: true,
      useAccelerateEndpoint: session.use_accelerated_endpoint,
      region: session.region,
      credentials: this.credentials,
    });
    return this.s3;
  }

  async uploadFile(file: File) {
    const session = await this.getSession();
    const s3 = await this.getS3();
    const uploader = new S3.ManagedUpload({
      service: s3,
      params: {
        Bucket: session.bucket,
        Key: `${session.prefix}${file.name}`,
        ContentType: file.type,
        Body: file,
      },
    });
    uploader.on('httpUploadProgress', (progress) => {
      this.props.onProgress(file.name, false, progress.total ? progress.loaded/progress.total : null);
    });
    this.props.onProgress(file.name, false, null);
    await uploader.promise();
    this.props.onProgress(file.name, true, 1);
  }

  async reportComplete() {
    const sessionPayload: CompleteRequest = {name: this.props.name, token: this.props.token, continuation_handler: this.session?.continuation_handler || null};
    const resp = await fetch('/api-prd/complete', {method: 'POST', credentials: 'include', body: JSON.stringify(sessionPayload)});
    if (resp.ok) {
      const data = await resp.json();
      return data;
    } else {
      throw new Error(`Cannot report result: status=${resp.status}, text=${await resp.text()}`);
    }
  }

  public async perform() {
    const session = await this.getSession();
    const s3 = await this.getS3();
    this.props.onStarted();

    for (const file of this.props.files) {
      await this.uploadFile(file);
    }

    this.props.onFinalizeStarted();
    await this.reportComplete();

    this.props.onFinished();
    this.done = true;
  }
}
