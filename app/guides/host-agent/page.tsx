import type { Metadata } from "next";
import Link from "next/link";
import styles from "../guides.module.css";

const AGENT_VERSION = "1.5.0";
const ARCHIVE = `kai-host-agent-${AGENT_VERSION}.tgz`;

export const metadata: Metadata = {
  title: "Host Agent 安装教程",
  description: "下载、校验、安装并配对 KAI Host Agent，让单张 RTX 4090 或 H100 完成真实验真。",
};

function Command({ children }: { children: string }) {
  return <pre className={styles.commandBlock} tabIndex={0}><code>{children}</code></pre>;
}

export default function HostAgentGuidePage() {
  return (
    <div className={`${styles.docsPage} ${styles.agentGuide}`}>
      <div className={styles.docsTopbar}>
        <div><span>KAI Cloud Docs</span><b>Host Agent 安装与配对</b></div>
        <div><Link href="/hosting/personal-gpu">上架要求</Link><Link href="/login?returnTo=%2Fsupply%2Fresources%2Fnew">进入供应商控制台</Link></div>
      </div>
      <article className={`${styles.article} ${styles.articleStandalone}`}>
        <header className={styles.articleHero}>
          <p>HOST AGENT · {AGENT_VERSION}</p>
          <h1>先校验安装包，再让一台真实 GPU 接入平台。</h1>
          <p>安装包由当前网站版本自动生成，不包含密钥、账号、配对码或服务器配置。不要使用第三方脚本，也不要把下载命令直接管道给 root shell。</p>
          <div className={styles.choiceGrid}>
            <a download href={`/downloads/${ARCHIVE}`}><span>安装包</span><strong>下载 {ARCHIVE}</strong><small>Ubuntu · Node.js 24.15+ · systemd</small></a>
            <a download href={`/downloads/${ARCHIVE}.sha256`}><span>完整性</span><strong>下载 SHA-256 校验文件</strong><small>校验失败时立即停止</small></a>
          </div>
        </header>

        <section>
          <div className={styles.sectionLabel}>01 · REQUIREMENTS</div>
          <h2>准备一台首期支持的主机</h2>
          <p className={styles.lead}>首期只接受 Ubuntu 上的单张 RTX 4090 或单张 H100，禁止 MIG 和多租户切片。机器必须具备 NVIDIA 驱动、Docker Engine、NVIDIA Container Toolkit、稳定公网地址和最多 200 个预留端口。</p>
          <div className={styles.note}><strong>不会在普通云服务器上假装 GPU</strong><p>安装器会检查 `nvidia-smi`、Docker Unix Socket、Node.js 和 systemd；缺失任意一项都会退出，不会登记虚假设备。</p></div>
        </section>

        <section>
          <div className={styles.sectionLabel}>02 · VERIFY PACKAGE</div>
          <h2>校验并审阅安装包</h2>
          <Command>{`cd ~/Downloads\nsha256sum --check ${ARCHIVE}.sha256\ntar -tzf ${ARCHIVE}\ntar -xzf ${ARCHIVE}\ncd kai-host-agent-${AGENT_VERSION}\nless release-manifest.json\nless install.sh`}</Command>
          <p>只有 `sha256sum` 返回 OK、文件清单与页面版本一致时才继续。安装包内的 `release-manifest.json` 还记录每个源文件的摘要和网站提交版本。</p>
        </section>

        <section>
          <div className={styles.sectionLabel}>03 · DOCTOR & INSTALL</div>
          <h2>先检查主机，再安装受限服务</h2>
          <Command>{`sudo ./install.sh\nsudo -u kai-host-agent -- kai-host-agent doctor \\\n  --public-host "gpu.example.com" \\\n  --ssh-port-start "22000" \\\n  --ssh-port-end "22019"`}</Command>
          <p>安装完成时，只有本机 root Actuator 会启动；联网的 Host Agent 仍保持停止。Actuator 只接受验真、创建受控容器、启动、停止和清理五类固定动作，不提供任意宿主机 Shell。</p>
        </section>

        <section>
          <div className={styles.sectionLabel}>04 · PAIR</div>
          <h2>用五分钟一次性凭证完成配对</h2>
          <ol className={styles.steps}>
            <li><span>1</span><div><h3>完成供应商审核</h3><p>登录后进入供应商控制台，提交主体与设备权属资料，等待管理员批准。</p></div></li>
            <li><span>2</span><div><h3>签发配对内容</h3><p>在“资源 → 登记新资源”签发一次性 JSON。它只在五分钟内有效，成功注册后立即失效。</p></div></li>
            <li><span>3</span><div><h3>通过标准输入配对</h3><p>把 JSON 保存到 root-owned 临时文件，不要放进命令参数、聊天或日志。</p></div></li>
          </ol>
          <Command>{`sudo install -o kai-host-agent -g kai-host-agent -m 0600 pairing.json /var/lib/kai-host-agent/pairing.json\nsudo -u kai-host-agent -- kai-host-agent pair \\\n  --display-name "4090 工作站 01" \\\n  --public-host "gpu.example.com" \\\n  --ssh-port-start "22000" \\\n  --ssh-port-end "22019" \\\n  < /var/lib/kai-host-agent/pairing.json\nsudo shred -u /var/lib/kai-host-agent/pairing.json`}</Command>
        </section>

        <section>
          <div className={styles.sectionLabel}>05 · APPROVED IMAGE & START</div>
          <h2>配置平台批准的不可变镜像</h2>
          <p>从供应商控制台复制完整的 `ghcr.io/...@sha256:...` 镜像摘要，写入 `/etc/kai-host-actuator.env`。`latest`、普通 tag 和任意第三方仓库都会被拒绝。</p>
          <Command>{`sudoedit /etc/kai-host-actuator.env\nsudo systemctl restart kai-host-actuator\nsudo systemctl enable --now kai-host-agent\nsudo systemctl status kai-host-agent --no-pager`}</Command>
        </section>

        <section>
          <div className={styles.sectionLabel}>06 · VERIFY & RECOVERY</div>
          <h2>回到控制台完成验真</h2>
          <p>设备心跳出现后创建验真任务。平台会核对 GPU 身份、CUDA、显存、存储、网络和端口可达性。证据过期、规格变化、Agent 离线或清理失败会自动暂停报价；清理失败的设备保持 DRAINING，不能再次出租。</p>
          <Link className={styles.actionLink} href="/login?returnTo=%2Fsupply%2Fresources">查看设备与验真状态 →</Link>
        </section>
      </article>
    </div>
  );
}
