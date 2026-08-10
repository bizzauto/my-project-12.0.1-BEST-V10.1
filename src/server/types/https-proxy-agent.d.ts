declare module 'https-proxy-agent' {
  import { Agent } from 'http';

  class HttpsProxyAgent extends Agent {
    constructor(proxy: string, options?: any);
  }

  export { HttpsProxyAgent };
  export default HttpsProxyAgent;
}
