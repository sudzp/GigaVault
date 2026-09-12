package com.gigavault.backend.repository;

import com.gigavault.backend.model.UploadSession;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UploadSessionRepository extends JpaRepository<UploadSession, String> {
}
