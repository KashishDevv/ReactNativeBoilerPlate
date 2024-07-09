import { createAsyncThunk, createSlice } from "@reduxjs/toolkit";
import axios from "axios";

export const fetchData = createAsyncThunk("fetchData", async () => {
  const url = "https://dummyjson.com/products/2";
  const { data } = await axios.get(url);
  return data;
});


const initialState = {
  loading: false,
  data: {
    success: false,
    data: {
      rows: [],
      meta: { currentPage: 0, count: 0, pageCount: 0, pageSize: 0 },
    },
  },
  error: "",
};

const fetchSlice = createSlice({
  name: "fetchData",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder.addCase(fetchData.pending, (state) => {
      state.loading = true;
    });
    builder.addCase(fetchData.fulfilled, (state, action) => {
      state.loading = false;
      state.data = action.payload;
      state.error = "";
    });
    builder.addCase(fetchData.rejected, (state, action) => {
      (state.loading = false),
        (state.error = action.error.message ? action.error.message : "");
    });
  },
});

export default fetchSlice.reducer

