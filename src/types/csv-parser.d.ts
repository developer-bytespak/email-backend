declare module 'csv-parser' {
  import { Transform } from 'stream';
  
  interface Options {
    separator?: string;
    headers?: string[] | boolean;
    skipLines?: number;
  }
  
  function csv(options?: Options): Transform;
  
  export = csv;
}

