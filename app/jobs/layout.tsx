import Link from "next/link";

import { signOut } from "@/lib/auth/actions";
import { requireUser } from "@/lib/auth/session";

import styles from "../ui.module.css";

export default async function JobsLayout({ children }: LayoutProps<"/jobs">) {
  const user = await requireUser("/jobs");

  return (
    <>
      <header className={styles.header}>
        <Link className={styles.brand} href="/jobs">
          Trilha
        </Link>
        <div className={styles.row}>
          {user.email && <span className={styles.muted}>{user.email}</span>}
          <form action={signOut}>
            <button className={styles.linkButton} type="submit">
              Sair
            </button>
          </form>
        </div>
      </header>
      {children}
    </>
  );
}
