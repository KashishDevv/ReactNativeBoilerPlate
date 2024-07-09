import axios from 'axios';
import { Urls } from '../constants/Urls';

const API = axios.create({
  baseURL: Urls.BASE_URL,
  timeout: 50000,
  headers: { 'Content-Type': 'application/json' }
});

export default API;    