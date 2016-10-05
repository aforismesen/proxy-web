import toolsUrl from 'url';
import request from 'request-promise-native';
import htmlparser from 'htmlparser2';
import _ from 'lodash';
import ent from 'ent';
import {PORT, HOST} from './constants';

const PROXY_URL = `${HOST}/proxy?url=`;

class ProxyResource {
  constructor(req, res) {
    this.req = req;
    this.res = res;

    this.url = req.query.url;
    this.parsedUrl = toolsUrl.parse(this.url);
    this.host = `${this.parsedUrl.protocol}//${this.parsedUrl.host}`;
  }

  async load() {
    let headers = this.req.headers;
    headers.host = this.parsedUrl.host;
    headers.referer = `${this.host}/`;
    delete headers['accept-encoding'];
    return request({
      method: this.req.method,
      uri: this.url,
      resolveWithFullResponse: true,
      encoding: null,
      headers: headers,
    });
  }

  async proxy() {
    let response;
    try {
      response = await this.load();
    } catch (e) {
      console.error('Error ', e.statusCode, ' for ', this.url);
      this.res.status(e.statusCode)
              .set(e.response.headers)
              .send('Not found');
      return;
    }

    const output = this.parse(response);
    this.res.set(response.headers);
    this.res.send(output);
  }

  parse(response) {
    const contentType = response.headers['content-type'];
    if (contentType.includes('text/html')) {
      return this.parseHTML(response.body.toString());
    } else if (contentType.includes('text/css')) {
      return this.parseCSS(response.body.toString());
    }
    return response.body;
  }

  parseHTML(body) {
    let output = '' + body;
    let urls = [];
    const urlAttrs = ['href', 'src'];

    const parser = new htmlparser.Parser({
      onopentag: (name, attrs) => {
        for (var i = 0; i < urlAttrs.length; i++) {
          const attr = urlAttrs[i];
          if (attrs[attr]) {
            urls.push(attrs[attr]);
          }
        }
      },
    }, {decodeEntities: false});
    parser.write(body);
    parser.end();

    const matches = [];
    for (var i = 0; i < urlAttrs.length; i++) {
      const attr = urlAttrs[i];
      matches.push(`${attr}="$0"`);
      matches.push(`${attr}='$0'`);
      matches.push(`${attr}=$0`);
    }

    for (var i = 0; i < urls.length; i++) {
      const url = urls[i];
      if (url.indexOf('#') === 0) {
        continue;
      }

      const newUrl = this.resolveURL(ent.decode(url));

      for (var j = 0; j < matches.length; j++) {
        const match = matches[j];
        output = output.replace(match.replace('$0', url), match.replace('$0', newUrl));
      }
    }

    return output;
  }

  parseCSS(body) {
    let output = '' + body;
    output = output.replace(/url\((.*?)\)/ig, (match, $0) => {
      if ($0.indexOf('data:') === 0) {
        return `url(${$0})`;
      }

      let url = $0.replace(/^"|'/, '');
      url = url.replace(/"|'$/, '');
      return `url(${this.resolveURL(url)})`;
    });
    return output;
  }

  resolveURL(url) {
    let resolved;
    if (url.indexOf('//') === 0) {
      resolved = `${this.parsedUrl.protocol}${url}`;
    } else {
      resolved = toolsUrl.resolve(this.url, url);
    }
    return `${PROXY_URL}${encodeURIComponent(resolved)}`;
  }
}

export default ProxyResource;