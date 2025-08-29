import api from './api';
import { toast } from 'react-toastify';
import { 
  MEDICAL_RECORD_TYPES,
  DOCUMENT_TYPES,
  ACCESS_PERMISSIONS,
  APPOINTMENT_STATUSES 
} from '../utils/constants';

class PatientService {
  constructor() {
    this.apiEndpoint = '/patients';
  }

  async getProfile() {
    try {
      const response = await api.get(`${this.apiEndpoint}/my-profile`);
      return response.data;
    } catch (error) {
      console.error('Failed to get patient profile:', error);
      toast.error('Failed to load profile');
      throw error;
    }
  }

  async updateProfile(profileData) {
    try {
      const response = await api.put(`${this.apiEndpoint}/my-profile`, profileData);
      toast.success('Profile updated successfully');
      return response.data;
    } catch (error) {
      console.error('Failed to update profile:', error);
      toast.error(error.response?.data?.message || 'Failed to update profile');
      throw error;
    }
  }

  async getMedicalRecords(filters = {}) {
    try {
      const params = new URLSearchParams();
      
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);
      if (filters.recordType) params.append('recordType', filters.recordType);
      if (filters.page) params.append('page', filters.page);
      if (filters.limit) params.append('limit', filters.limit);
      if (filters.sortBy) params.append('sortBy', filters.sortBy);
      if (filters.sortOrder) params.append('sortOrder', filters.sortOrder);
      
      const queryString = params.toString();
      const url = queryString ? `/medical-records?${queryString}` : '/medical-records';
      
      const response = await api.get(url);
      return response.data;
    } catch (error) {
      console.error('Failed to get medical records:', error);
      toast.error('Failed to load medical records');
      throw error;
    }
  }

  async getMedicalRecord(recordId) {
    try {
      const response = await api.get(`/medical-records/${recordId}`);
      return response.data;
    } catch (error) {
      console.error('Failed to get medical record:', error);
      toast.error('Failed to load medical record');
      throw error;
    }
  }

  async createMedicalRecord(recordData) {
    try {
      const response = await api.post('/medical-records', recordData);
      toast.success('Medical record created successfully');
      return response.data;
    } catch (error) {
      console.error('Failed to create medical record:', error);
      toast.error(error.response?.data?.message || 'Failed to create medical record');
      throw error;
    }
  }

  async updateMedicalRecord(recordId, recordData) {
    try {
      const response = await api.put(`/medical-records/${recordId}`, recordData);
      toast.success('Medical record updated successfully');
      return response.data;
    } catch (error) {
      console.error('Failed to update medical record:', error);
      toast.error(error.response?.data?.message || 'Failed to update medical record');
      throw error;
    }
  }

  async deleteMedicalRecord(recordId) {
    try {
      const response = await api.delete(`/medical-records/${recordId}`);
      toast.success('Medical record deleted successfully');
      return response.data;
    } catch (error) {
      console.error('Failed to delete medical record:', error);
      toast.error(error.response?.data?.message || 'Failed to delete medical record');
      throw error;
    }
  }

  async uploadDocument(file, documentData, onProgress = null) {
    try {
      const formData = new FormData();
      formData.append('document', file);
      formData.append('documentType', documentData.documentType);
      
      if (documentData.description) {
        formData.append('description', documentData.description);
      }
      if (documentData.category) {
        formData.append('category', documentData.category);
      }
      if (documentData.isPublic !== undefined) {
        formData.append('isPublic', documentData.isPublic);
      }

      const config = {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (progressEvent) => {
          if (onProgress) {
            const percentCompleted = Math.round(
              (progressEvent.loaded * 100) / progressEvent.total
            );
            onProgress(percentCompleted);
          }
        }
      };

      const response = await api.post('/documents/upload', formData, config);
      toast.success('Document uploaded successfully');
      return response.data;
    } catch (error) {
      console.error('Failed to upload document:', error);
      toast.error(error.response?.data?.message || 'Failed to upload document');
      throw error;
    }
  }

  async getDocuments(filters = {}) {
    try {
      const params = new URLSearchParams();
      
      if (filters.documentType) params.append('documentType', filters.documentType);
      if (filters.category) params.append('category', filters.category);
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);
      if (filters.page) params.append('page', filters.page);
      if (filters.limit) params.append('limit', filters.limit);
      
      const queryString = params.toString();
      const url = queryString ? `/documents?${queryString}` : '/documents';
      
      const response = await api.get(url);
      return response.data;
    } catch (error) {
      console.error('Failed to get documents:', error);
      toast.error('Failed to load documents');
      throw error;
    }
  }

  async downloadDocument(documentId) {
    try {
      const response = await api.get(`/documents/${documentId}/download`, {
        responseType: 'blob'
      });
      
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      
      const contentDisposition = response.headers['content-disposition'];
      const filename = contentDisposition
        ? contentDisposition.split('filename=')[1]?.replace(/"/g, '')
        : `document-${documentId}`;
        
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      return response.data;
    } catch (error) {
      console.error('Failed to download document:', error);
      toast.error('Failed to download document');
      throw error;
    }
  }

  async deleteDocument(documentId) {
    try {
      const response = await api.delete(`/documents/${documentId}`);
      toast.success('Document deleted successfully');
      return response.data;
    } catch (error) {
      console.error('Failed to delete document:', error);
      toast.error(error.response?.data?.message || 'Failed to delete document');
      throw error;
    }
  }

  async getAccessGrants() {
    try {
      const response = await api.get('/access-grants');
      return response.data;
    } catch (error) {
      console.error('Failed to get access grants:', error);
      toast.error('Failed to load access grants');
      throw error;
    }
  }

  async grantAccess(grantData) {
    try {
      const response = await api.post('/access-grants', {
        doctorWallet: grantData.doctorWallet,
        permissions: grantData.permissions,
        resourceTypes: grantData.resourceTypes || ['all'],
        expirationDate: grantData.expirationDate,
        conditions: grantData.conditions,
        purpose: grantData.purpose
      });
      
      toast.success('Access granted successfully');
      return response.data;
    } catch (error) {
      console.error('Failed to grant access:', error);
      toast.error(error.response?.data?.message || 'Failed to grant access');
      throw error;
    }
  }

  async revokeAccess(grantId) {
    try {
      const response = await api.delete(`/access-grants/${grantId}`);
      toast.success('Access revoked successfully');
      return response.data;
    } catch (error) {
      console.error('Failed to revoke access:', error);
      toast.error(error.response?.data?.message || 'Failed to revoke access');
      throw error;
    }
  }

  async getAccessLogs(filters = {}) {
    try {
      const params = new URLSearchParams();
      
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);
      if (filters.action) params.append('action', filters.action);
      if (filters.doctorId) params.append('doctorId', filters.doctorId);
      if (filters.page) params.append('page', filters.page);
      if (filters.limit) params.append('limit', filters.limit);
      
      const queryString = params.toString();
      const url = queryString ? `/access-logs?${queryString}` : '/access-logs';
      
      const response = await api.get(url);
      return response.data;
    } catch (error) {
      console.error('Failed to get access logs:', error);
      toast.error('Failed to load access logs');
      throw error;
    }
  }

  async getAppointments(filters = {}) {
    try {
      const params = new URLSearchParams();
      
      if (filters.status) params.append('status', filters.status);
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);
      if (filters.doctorId) params.append('doctorId', filters.doctorId);
      if (filters.page) params.append('page', filters.page);
      if (filters.limit) params.append('limit', filters.limit);
      
      const queryString = params.toString();
      const url = queryString ? `/appointments?${queryString}` : '/appointments';
      
      const response = await api.get(url);
      return response.data;
    } catch (error) {
      console.error('Failed to get appointments:', error);
      toast.error('Failed to load appointments');
      throw error;
    }
  }

  async scheduleAppointment(appointmentData) {
    try {
      const response = await api.post('/appointments', appointmentData);
      toast.success('Appointment scheduled successfully');
      return response.data;
    } catch (error) {
      console.error('Failed to schedule appointment:', error);
      toast.error(error.response?.data?.message || 'Failed to schedule appointment');
      throw error;
    }
  }

  async updateAppointment(appointmentId, appointmentData) {
    try {
      const response = await api.put(`/appointments/${appointmentId}`, appointmentData);
      toast.success('Appointment updated successfully');
      return response.data;
    } catch (error) {
      console.error('Failed to update appointment:', error);
      toast.error(error.response?.data?.message || 'Failed to update appointment');
      throw error;
    }
  }

  async cancelAppointment(appointmentId, reason) {
    try {
      const response = await api.patch(`/appointments/${appointmentId}/cancel`, {
        reason,
        cancelledBy: 'patient'
      });
      toast.success('Appointment cancelled successfully');
      return response.data;
    } catch (error) {
      console.error('Failed to cancel appointment:', error);
      toast.error(error.response?.data?.message || 'Failed to cancel appointment');
      throw error;
    }
  }

  async getHealthMetrics(filters = {}) {
    try {
      const params = new URLSearchParams();
      
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate) params.append('endDate', filters.endDate);
      if (filters.metricType) params.append('metricType', filters.metricType);
      if (filters.page) params.append('page', filters.page);
      if (filters.limit) params.append('limit', filters.limit);
      
      const queryString = params.toString();
      const url = queryString ? `/health-metrics?${queryString}` : '/health-metrics';
      
      const response = await api.get(url);
      return response.data;
    } catch (error) {
      console.error('Failed to get health metrics:', error);
      toast.error('Failed to load health metrics');
      throw error;
    }
  }

  async addHealthMetric(metricData) {
    try {
      const response = await api.post('/health-metrics', metricData);
      toast.success('Health metric added successfully');
      return response.data;
    } catch (error) {
      console.error('Failed to add health metric:', error);
      toast.error(error.response?.data?.message || 'Failed to add health metric');
      throw error;
    }
  }

  async getBlockchainRecords(filters = {}) {
    try {
      const params = new URLSearchParams();
      
      if (filters.startBlock) params.append('startBlock', filters.startBlock);
      if (filters.endBlock) params.append('endBlock', filters.endBlock);
      if (filters.transactionType) params.append('transactionType', filters.transactionType);
      if (filters.page) params.append('page', filters.page);
      if (filters.limit) params.append('limit', filters.limit);
      
      const queryString = params.toString();
      const url = queryString ? `/blockchain/records?${queryString}` : '/blockchain/records';
      
      const response = await api.get(url);
      return response.data;
    } catch (error) {
      console.error('Failed to get blockchain records:', error);
      toast.error('Failed to load blockchain records');
      throw error;
    }
  }

  async verifyDataIntegrity(recordId) {
    try {
      const response = await api.post(`/blockchain/verify/${recordId}`);
      
      if (response.data.isValid) {
        toast.success('Data integrity verified successfully');
      } else {
        toast.warning('Data integrity verification failed');
      }
      
      return response.data;
    } catch (error) {
      console.error('Failed to verify data integrity:', error);
      toast.error('Failed to verify data integrity');
      throw error;
    }
  }

  async shareRecord(recordId, shareData) {
    try {
      const response = await api.post(`/medical-records/${recordId}/share`, {
        recipientEmail: shareData.recipientEmail,
        permissions: shareData.permissions,
        expirationDate: shareData.expirationDate,
        message: shareData.message,
        requireSignature: shareData.requireSignature || false
      });
      
      toast.success('Record shared successfully');
      return response.data;
    } catch (error) {
      console.error('Failed to share record:', error);
      toast.error(error.response?.data?.message || 'Failed to share record');
      throw error;
    }
  }

  async generateHealthReport(options = {}) {
    try {
      const response = await api.post('/reports/health', {
        startDate: options.startDate,
        endDate: options.endDate,
        includeRecords: options.includeRecords !== false,
        includeMetrics: options.includeMetrics !== false,
        includeAppointments: options.includeAppointments !== false,
        format: options.format || 'pdf'
      });
      
      toast.success('Health report generated successfully');
      return response.data;
    } catch (error) {
      console.error('Failed to generate health report:', error);
      toast.error(error.response?.data?.message || 'Failed to generate health report');
      throw error;
    }
  }

  async getDashboardData(timeframe = '30d') {
    try {
      const response = await api.get(`/dashboard?timeframe=${timeframe}`);
      return response.data;
    } catch (error) {
      console.error('Failed to get dashboard data:', error);
      throw error;
    }
  }

  async updatePrivacySettings(settings) {
    try {
      const response = await api.put('/settings/privacy', settings);
      toast.success('Privacy settings updated successfully');
      return response.data;
    } catch (error) {
      console.error('Failed to update privacy settings:', error);
      toast.error(error.response?.data?.message || 'Failed to update privacy settings');
      throw error;
    }
  }

  async updateNotificationSettings(settings) {
    try {
      const response = await api.put('/settings/notifications', settings);
      toast.success('Notification settings updated successfully');
      return response.data;
    } catch (error) {
      console.error('Failed to update notification settings:', error);
      toast.error(error.response?.data?.message || 'Failed to update notification settings');
      throw error;
    }
  }

  async exportData(options = {}) {
    try {
      const response = await api.post('/export', {
        format: options.format || 'json',
        includeRecords: options.includeRecords !== false,
        includeDocuments: options.includeDocuments !== false,
        includeMetrics: options.includeMetrics !== false,
        startDate: options.startDate,
        endDate: options.endDate
      }, {
        responseType: 'blob'
      });
      
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      
      const filename = `health-data-export-${new Date().toISOString().split('T')[0]}.${options.format || 'json'}`;
      link.setAttribute('download', filename);
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      
      toast.success('Data exported successfully');
      return response.data;
    } catch (error) {
      console.error('Failed to export data:', error);
      toast.error(error.response?.data?.message || 'Failed to export data');
      throw error;
    }
  }

  async deleteAccount(password, confirmation) {
    try {
      const response = await api.delete('/account', {
        data: {
          password,
          confirmation
        }
      });
      
      toast.success('Account deletion initiated');
      return response.data;
    } catch (error) {
      console.error('Failed to delete account:', error);
      toast.error(error.response?.data?.message || 'Failed to delete account');
      throw error;
    }
  }

  async searchDoctors(query, filters = {}) {
    try {
      const params = new URLSearchParams();
      params.append('query', query);
      
      if (filters.specialty) params.append('specialty', filters.specialty);
      if (filters.location) params.append('location', filters.location);
      if (filters.availability) params.append('availability', filters.availability);
      if (filters.rating) params.append('rating', filters.rating);
      if (filters.page) params.append('page', filters.page);
      if (filters.limit) params.append('limit', filters.limit);
      
      const response = await api.get(`/doctors/search?${params.toString()}`);
      return response.data;
    } catch (error) {
      console.error('Failed to search doctors:', error);
      toast.error('Failed to search doctors');
      throw error;
    }
  }

  async requestEmergencyAccess(doctorWallet, reason) {
    try {
      const response = await api.post('/access-grants/emergency', {
        doctorWallet,
        reason,
        duration: '24h'
      });
      
      toast.success('Emergency access granted');
      return response.data;
    } catch (error) {
      console.error('Failed to grant emergency access:', error);
      toast.error(error.response?.data?.message || 'Failed to grant emergency access');
      throw error;
    }
  }

  formatRecordForDisplay(record) {
    return {
      ...record,
      typeLabel: MEDICAL_RECORD_TYPES[record.type] || record.type,
      formattedDate: new Date(record.createdAt).toLocaleDateString(),
      formattedTime: new Date(record.createdAt).toLocaleTimeString()
    };
  }

  validateMedicalRecord(recordData) {
    const errors = {};

    if (!recordData.type || !Object.values(MEDICAL_RECORD_TYPES).includes(recordData.type)) {
      errors.type = 'Valid record type is required';
    }

    if (!recordData.title || recordData.title.trim().length < 3) {
      errors.title = 'Title must be at least 3 characters long';
    }

    if (!recordData.description || recordData.description.trim().length < 10) {
      errors.description = 'Description must be at least 10 characters long';
    }

    if (recordData.date && new Date(recordData.date) > new Date()) {
      errors.date = 'Record date cannot be in the future';
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors
    };
  }

  validateAccessGrant(grantData) {
    const errors = {};

    if (!grantData.doctorWallet || !/^0x[a-fA-F0-9]{40}$/.test(grantData.doctorWallet)) {
      errors.doctorWallet = 'Valid doctor wallet address is required';
    }

    if (!grantData.permissions || !Array.isArray(grantData.permissions) || grantData.permissions.length === 0) {
      errors.permissions = 'At least one permission must be selected';
    }

    if (grantData.permissions && !grantData.permissions.every(p => Object.values(ACCESS_PERMISSIONS).includes(p))) {
      errors.permissions = 'Invalid permission selected';
    }

    if (grantData.expirationDate && new Date(grantData.expirationDate) <= new Date()) {
      errors.expirationDate = 'Expiration date must be in the future';
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors
    };
  }

  validateDocumentUpload(file, documentType) {
    const errors = {};
    const maxSize = 50 * 1024 * 1024;
    const allowedTypes = [
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/gif',
      'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];

    if (!file) {
      errors.file = 'File is required';
      return { isValid: false, errors };
    }

    if (file.size > maxSize) {
      errors.file = 'File size must be less than 50MB';
    }

    if (!allowedTypes.includes(file.type)) {
      errors.file = 'File type not supported';
    }

    if (!documentType || !Object.values(DOCUMENT_TYPES).includes(documentType)) {
      errors.documentType = 'Valid document type is required';
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors
    };
  }

  getRecordTypeIcon(recordType) {
    const icons = {
      [MEDICAL_RECORD_TYPES.DIAGNOSIS]: '🩺',
      [MEDICAL_RECORD_TYPES.PRESCRIPTION]: '💊',
      [MEDICAL_RECORD_TYPES.LAB_RESULT]: '🧪',
      [MEDICAL_RECORD_TYPES.IMAGING]: '🔬',
      [MEDICAL_RECORD_TYPES.SURGERY]: '⚕️',
      [MEDICAL_RECORD_TYPES.CONSULTATION]: '👨‍⚕️',
      [MEDICAL_RECORD_TYPES.TREATMENT_PLAN]: '📋',
      [MEDICAL_RECORD_TYPES.PROGRESS_NOTE]: '📝'
    };

    return icons[recordType] || '📄';
  }

  getAppointmentStatusColor(status) {
    const colors = {
      [APPOINTMENT_STATUSES.SCHEDULED]: 'blue',
      [APPOINTMENT_STATUSES.CONFIRMED]: 'green',
      [APPOINTMENT_STATUSES.IN_PROGRESS]: 'yellow',
      [APPOINTMENT_STATUSES.COMPLETED]: 'gray',
      [APPOINTMENT_STATUSES.CANCELLED]: 'red',
      [APPOINTMENT_STATUSES.NO_SHOW]: 'red',
      [APPOINTMENT_STATUSES.RESCHEDULED]: 'orange'
    };

    return colors[status] || 'gray';
  }
}

const patientService = new PatientService();
export default patientService;