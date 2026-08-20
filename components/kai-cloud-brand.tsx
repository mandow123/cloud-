import Image from "next/image";
import styles from "./kai-cloud-brand.module.css";

type KaiCloudBrandSize = "header" | "footer" | "console";

export function KaiCloudBrand({ size = "header" }: { size?: KaiCloudBrandSize }) {
  return (
    <span aria-label="KAI Cloud" className={`${styles.brand} ${styles[size]}`} role="img">
      <Image alt="" aria-hidden="true" className={styles.logo} height={64} priority={size === "header"} src="/kai-logo.svg" width={144} />
      <span aria-hidden="true" className={styles.cloud}>Cloud</span>
    </span>
  );
}
