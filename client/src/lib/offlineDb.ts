// Simple native IndexedDB wrapper for offline storage of site reports.
const DB_NAME = 'TimestrapOfflineDB';
const DB_VERSION = 1;

export interface OfflineSiteReport {
  id?: string;
  localId: string;
  data: any;
  attachments: {
    fileName: string;
    fileType: string;
    base64Data: string;
  }[];
  status: 'pending' | 'synced' | 'error';
  timestamp: number;
}

class OfflineDB {
  private db: IDBDatabase | null = null;

  async init(): Promise<IDBDatabase> {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event: any) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('siteReports')) {
          db.createObjectStore('siteReports', { keyPath: 'localId' });
        }
      };

      request.onsuccess = (event: any) => {
        this.db = event.target.result;
        resolve(this.db!);
      };

      request.onerror = (event: any) => {
        reject(event.target.error);
      };
    });
  }

  async saveReport(report: OfflineSiteReport): Promise<void> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['siteReports'], 'readwrite');
      const store = transaction.objectStore('siteReports');
      const request = store.put(report);

      request.onsuccess = () => resolve();
      request.onerror = (event: any) => reject(event.target.error);
    });
  }

  async getAllReports(): Promise<OfflineSiteReport[]> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['siteReports'], 'readonly');
      const store = transaction.objectStore('siteReports');
      const request = store.getAll();

      request.onsuccess = (event: any) => resolve(event.target.result);
      request.onerror = (event: any) => reject(event.target.error);
    });
  }

  async deleteReport(localId: string): Promise<void> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['siteReports'], 'readwrite');
      const store = transaction.objectStore('siteReports');
      const request = store.delete(localId);

      request.onsuccess = () => resolve();
      request.onerror = (event: any) => reject(event.target.error);
    });
  }

  async updateReportStatus(localId: string, status: 'pending' | 'synced' | 'error'): Promise<void> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(['siteReports'], 'readwrite');
      const store = transaction.objectStore('siteReports');
      const getRequest = store.get(localId);

      getRequest.onsuccess = (event: any) => {
        const report = event.target.result;
        if (report) {
          report.status = status;
          store.put(report);
          resolve();
        } else {
          reject(new Error('Report not found'));
        }
      };
      getRequest.onerror = (event: any) => reject(event.target.error);
    });
  }
}

export const offlineDb = new OfflineDB();
