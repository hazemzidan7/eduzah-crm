import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import { AuthProvider } from './context/AuthContext'
import { CatalogProvider } from './context/CatalogContext'
import { LeadStatusProvider } from './context/LeadStatusContext'
import { CustomFieldProvider } from './context/CustomFieldContext'
import { TagProvider } from './context/TagContext'
import { DictionaryProvider } from './context/DictionaryContext'
import { ImportProfileProvider } from './context/ImportProfileContext'
import { ImportBatchProvider } from './context/ImportBatchContext'
import { CustomerProvider } from './context/CustomerContext'
import { AccountingProvider } from './context/AccountingContext'
import { LangProvider } from './context/LangContext'
import { ThemeProvider } from './context/ThemeContext'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HelmetProvider>
      <BrowserRouter>
        <ThemeProvider>
          <LangProvider>
            <AuthProvider>
              <CatalogProvider>
                <LeadStatusProvider>
                  <CustomFieldProvider>
                    <TagProvider>
                      <DictionaryProvider>
                        <ImportProfileProvider>
                          <ImportBatchProvider>
                            <CustomerProvider>
                              <AccountingProvider>
                                <App />
                              </AccountingProvider>
                            </CustomerProvider>
                          </ImportBatchProvider>
                        </ImportProfileProvider>
                      </DictionaryProvider>
                    </TagProvider>
                  </CustomFieldProvider>
                </LeadStatusProvider>
              </CatalogProvider>
            </AuthProvider>
          </LangProvider>
        </ThemeProvider>
      </BrowserRouter>
    </HelmetProvider>
  </React.StrictMode>
)
