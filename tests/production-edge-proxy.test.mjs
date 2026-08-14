import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const nginx = readFileSync(new URL("../deploy/kai-cloud-edge-http-3054.conf", import.meta.url), "utf8");
const service = readFileSync(new URL("../deploy/kai-cloud-edge-http-3054.service", import.meta.url), "utf8");
const firewallService = readFileSync(new URL("../deploy/kai-cloud-edge-3054-firewall.service", import.meta.url), "utf8");

test("private edge overwrites forwarding metadata before the app trusts HTTPS", () => {
  assert.match(nginx, /listen 172\.31\.31\.78:3054 default_server;/u);
  assert.match(nginx, /proxy_pass http:\/\/127\.0\.0\.1:3051;/u);
  assert.match(nginx, /proxy_set_header Host cloud\.kai\.com;/u);
  assert.match(nginx, /proxy_set_header X-Forwarded-Proto https;/u);
  assert.match(nginx, /proxy_set_header X-Forwarded-Port 443;/u);
  assert.match(nginx, /proxy_set_header X-Forwarded-For \$remote_addr;/u);
  assert.match(nginx, /proxy_set_header Forwarded "";/u);
  assert.doesNotMatch(nginx, /\$proxy_add_x_forwarded_for|\$http_x_forwarded/u);
});

test("edge proxy is immutable, constrained and conflicts with the raw TCP socket", () => {
  assert.match(service, /Conflicts=kai-cloud-edge-3054\.socket/u);
  assert.match(service, /Requires=docker\.service kai-cloud-edge-3054-firewall\.service/u);
  assert.match(service, /--network host/u);
  assert.match(service, /--read-only/u);
  assert.match(service, /--cap-drop ALL/u);
  assert.match(service, /--security-opt no-new-privileges:true/u);
  assert.match(service, /--user 101:101/u);
  assert.match(service, /ExecStartPost=\/usr\/bin\/curl --retry 10 .*http:\/\/172\.31\.31\.78:3054\/api\/live/u);
  assert.match(service, /docker\.io\/library\/nginx@sha256:a8b39bd9cf0f83869a2162827a0caf6137ddf759d50a171451b335cecc87d236/u);
  assert.match(firewallService, /Before=.*kai-cloud-edge-http-3054\.service/u);
});
